/**
 * HTTP client and session lifecycle for the Cloudflare worker backend.
 *
 * The worker owns auth, history sync, billing and the speech proxy, so every
 * network call in the app funnels through here. The session (access + refresh
 * tokens) lives in the auth store for the UI and is mirrored to MMKV so a cold
 * start stays signed in. Access tokens are short-lived and are refreshed
 * transparently when a request needs one that is close to expiry.
 */

import { z } from "zod";

import type { AuthSession, AuthUser } from "@/store/auth";
import { auth$, authActions } from "@/store/auth";
import { buildSettingsSharedPrefs } from "@/store/settings";
import { mmkv } from "@/services/mmkv";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { fetchWithRetry, getWorkerUrl } from "@/utils/http";
import logger from "@/utils/logger";

export type { AuthSession, AuthUser };

const SESSION_STORAGE_KEY = "auth.session";
/** Refresh this long before an access token actually expires. */
const ACCESS_TOKEN_SKEW_MS = 60_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

const userPayloadSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  tier: z.enum(["FREE", "PREMIUM"]),
  displayName: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  avatarIcon: z.string().nullish(),
  proExpiresAt: z.number().nullish(),
});

export type UserPayload = z.infer<typeof userPayloadSchema>;

function toAuthUser(user: UserPayload): AuthUser {
  return {
    id: user.id,
    email: user.email,
    tier: user.tier,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    avatarIcon: user.avatarIcon ?? null,
    proExpiresAt: user.proExpiresAt ?? null,
  };
}

export function parseUserPayload(raw: unknown): AuthUser {
  return toAuthUser(userPayloadSchema.parse(raw));
}

const sessionResponseSchema = z.object({
  user: userPayloadSchema,
  accessToken: z.string().min(1),
  expiresAt: z.number(),
  refreshToken: z.string().min(1),
  refreshExpiresAt: z.number(),
});

export function parseSessionResponse(raw: unknown): AuthSession {
  const parsed = sessionResponseSchema.parse(raw);
  return {
    user: toAuthUser(parsed.user),
    accessToken: parsed.accessToken,
    expiresAt: parsed.expiresAt,
    refreshToken: parsed.refreshToken,
    refreshExpiresAt: parsed.refreshExpiresAt,
  };
}

export function loadStoredSession(): AuthSession | null {
  const stored = mmkv.getString(SESSION_STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as AuthSession;
    if (!parsed?.user?.id || !parsed.accessToken || !parsed.refreshToken) {
      return null;
    }
    if (parsed.refreshExpiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    logger.warn("[Backend] Discarding unreadable stored session");
    return null;
  }
}

export function persistSession(session: AuthSession | null): void {
  if (session) {
    mmkv.set(SESSION_STORAGE_KEY, JSON.stringify(session));
    mmkv.set("hasSession", true);
  } else {
    mmkv.remove(SESSION_STORAGE_KEY);
    mmkv.remove("hasSession");
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * A rotated refresh token replaces the stored one, so the new session has to
 * reach MMKV and the share container immediately — otherwise a cold start (or
 * the extension) keeps using a token the worker has already replaced.
 */
function applySession(session: AuthSession | null): void {
  authActions.setSession(session);
  persistSession(session);
  mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());
}

async function requestRefresh(): Promise<string | null> {
  const current = auth$.session.peek();
  if (!current) return null;

  if (current.refreshExpiresAt <= Date.now()) {
    applySession(null);
    return null;
  }

  const base = getWorkerUrl();
  if (!base) return null;

  try {
    const response = await fetchWithRetry(`${base}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
      timeout: 15_000,
      retries: 1,
    });

    if (response.status === 401) {
      logger.info("[Backend] Refresh token rejected; signing out");
      applySession(null);
      return null;
    }
    if (!response.ok) {
      logger.warn(`[Backend] Refresh failed with status ${response.status}`);
      return null;
    }

    const session = parseSessionResponse(await response.json());
    applySession(session);
    return session.accessToken;
  } catch (err) {
    logger.warn("[Backend] Refresh request failed", err);
    return null;
  }
}

/** Rotates the session, coalescing concurrent callers into one request. */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Returns a usable access token, refreshing it when it is close to expiry. */
export async function ensureAccessToken(): Promise<string | null> {
  const session = auth$.session.peek();
  if (!session) return null;
  if (session.expiresAt - Date.now() > ACCESS_TOKEN_SKEW_MS) {
    return session.accessToken;
  }
  return refreshSession();
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = `HTTP_${response.status}`;
  let message = `Request failed with status ${response.status}`;
  try {
    const body = (await response.json()) as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON error body; the status-derived message is enough.
  }
  return new ApiError(response.status, code, message);
}

export async function apiFetch(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    body,
    auth = true,
    timeoutMs = 20_000,
    retries = 2,
    signal,
  } = options;

  const base = getWorkerUrl();
  if (!base) {
    throw new ApiError(
      0,
      "NO_WORKER_URL",
      "The backend URL is not configured.",
    );
  }

  const url = `${base}${path}`;
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = await ensureAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return fetchWithRetry(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: timeoutMs,
      retries,
      signal,
    });
  };

  let response = await send();
  if (response.status === 401 && auth) {
    const token = await refreshSession();
    if (token) response = await send();
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function apiJson<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return (await apiFetch(path, options)).json() as Promise<T>;
}
