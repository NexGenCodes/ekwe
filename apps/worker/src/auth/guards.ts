import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { sha256 } from "@/auth/tokens";

const APP_CHECK_ISSUER = "https://firebaseappcheck.googleapis.com/";
const appCheckJwks = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
);

const TURNSTILE_ACTION = "send_otp";
const TURNSTILE_BLOCK_CODES = new Set([
  "invalid-input-response",
  "invalid-input-secret",
  "missing-input-response",
  "missing-input-secret",
  "bad-request",
]);

const ALERT_TTL_MS = 15 * 60 * 1000;
const alertCache = new Map<string, number>();

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function alertOnce(reason: string, detail?: Record<string, unknown>): void {
  const now = Date.now();
  if (now - (alertCache.get(reason) ?? 0) < ALERT_TTL_MS) return;
  alertCache.set(reason, now);
  logger.error(`[auth] Turnstile degraded, failing open (${reason})`, detail);
}

async function verifyAppCheck(env: Env, token: string): Promise<boolean> {
  const projectNumber = env.FIREBASE_PROJECT_NUMBER;
  if (!projectNumber) return false;

  try {
    const { payload } = await jwtVerify(token, appCheckJwks, {
      audience: [`projects/${projectNumber}`],
    });
    return (
      typeof payload.iss === "string" &&
      payload.iss.startsWith(APP_CHECK_ISSUER)
    );
  } catch {
    return false;
  }
}

async function verifyTurnstile(
  env: Env,
  token: string,
  clientIp: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return env.APP_ENV === "development";

  const allowedHostnames = (env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: clientIp,
        }),
      },
    );

    if (!response.ok) {
      alertOnce("siteverify_non_ok", { status: response.status });
      return true;
    }

    const result = await readJsonObject(response);

    if (result.success === false) {
      const codes = Array.isArray(result["error-codes"])
        ? result["error-codes"].filter(
            (code): code is string => typeof code === "string",
          )
        : [];
      if (codes.some((code) => TURNSTILE_BLOCK_CODES.has(code))) return false;
      alertOnce("validation_failed", { codes });
      return true;
    }

    if (result.action !== TURNSTILE_ACTION) return false;
    const hostname = typeof result.hostname === "string" ? result.hostname : "";
    if (allowedHostnames.length > 0 && !allowedHostnames.includes(hostname)) {
      return false;
    }
    return true;
  } catch (error) {
    alertOnce("siteverify_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

export interface BotCheck {
  ok: true;
}

export interface BotRejected {
  ok: false;
  code: string;
  status: number;
}

export async function checkBot(
  request: Request,
  env: Env,
  tokens: { turnstileToken?: string | null; appCheckToken?: string | null },
): Promise<BotCheck | BotRejected> {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const appCheckToken =
    tokens.appCheckToken || request.headers.get("X-Firebase-AppCheck");
  const requireAppCheck = env.REQUIRE_APP_CHECK as string | undefined;
  const appEnv = env.APP_ENV as string | undefined;

  let appCheckInvalid = false;
  if (appCheckToken) {
    if (await verifyAppCheck(env, appCheckToken)) return { ok: true };
    // A bad App Check token should not block a client that can still pass
    // Turnstile. Fall through and let Turnstile decide.
    appCheckInvalid = true;
  }

  if (tokens.turnstileToken) {
    return (await verifyTurnstile(env, tokens.turnstileToken, clientIp))
      ? { ok: true }
      : { ok: false, code: "TURNSTILE_INVALID", status: 403 };
  }

  if (requireAppCheck === "true" && appEnv !== "development") {
    return {
      ok: false,
      code: appCheckInvalid ? "APP_CHECK_INVALID" : "APP_CHECK_REQUIRED",
      status: 403,
    };
  }

  return { ok: true };
}

const THROTTLE_SHARDS = 8;

async function shardFor(key: string): Promise<string> {
  const digest = await sha256(key);
  return `otp-${parseInt(digest.slice(0, 2), 16) % THROTTLE_SHARDS}`;
}

export async function allowRequest(
  env: Env,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const failClosed = env.APP_ENV !== "development";

  try {
    const stub = env.THROTTLE_DO.getByName(
      await shardFor(key),
    ) as unknown as DurableObjectStub;
    const response = await stub.fetch(
      `https://throttle/allow?key=${encodeURIComponent(key)}&limit=${limit}&windowSec=${windowSec}`,
    );

    if (!response.ok) {
      logger.warn("[auth] throttle check failed", { status: response.status });
      return !failClosed;
    }

    const body = await readJsonObject(response);
    return body.allowed === true;
  } catch (error) {
    logger.warn("[auth] throttle unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return !failClosed;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
