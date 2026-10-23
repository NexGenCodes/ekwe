import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn(() => "https://worker.test"),
  fetchWithRetry: vi.fn(),
}));

vi.mock("@/services/sharedContainer", () => ({
  mirrorSessionToSharedContainer: vi.fn(),
  mirrorSettingsToShared: vi.fn(),
}));

vi.mock("@/services/mmkv", () => {
  const store = new Map<string, string>();
  return {
    initializeMMKV: vi.fn(async () => {}),
    mmkv: {
      getString: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      remove: vi.fn((key: string) => {
        store.delete(key);
      }),
      getAllKeys: vi.fn(() => [...store.keys()]),
      clearAll: vi.fn(() => store.clear()),
    },
  };
});

import {
  apiFetch,
  apiJson,
  ApiError,
  ensureAccessToken,
  loadStoredSession,
  parseSessionResponse,
  persistSession,
  refreshSession,
} from "@/services/backend";
import { mmkv } from "@/services/mmkv";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { auth$, authActions } from "@/store/auth";
import type { AuthSession } from "@/store/auth";
import { fetchWithRetry, getWorkerUrl } from "@/utils/http";

const SESSION_KEY = "auth.session";
const NOW = Date.now();

const USER = {
  id: "u1",
  email: "person@ekwe.app",
  tier: "FREE" as const,
  displayName: null,
  avatarUrl: null,
  avatarIcon: null,
  proExpiresAt: null,
};

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    user: USER,
    accessToken: "access-1",
    expiresAt: NOW + 1_800_000,
    refreshToken: "refresh-1",
    refreshExpiresAt: NOW + 2_592_000_000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    user: USER,
    accessToken: "access-1",
    expiresAt: NOW + 1_800_000,
    refreshToken: "refresh-1",
    refreshExpiresAt: NOW + 2_592_000_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.remove(SESSION_KEY);
  authActions.setSession(null);
  vi.mocked(getWorkerUrl).mockReturnValue("https://worker.test");
});

describe("parseSessionResponse", () => {
  it("maps the worker payload onto the session shape", () => {
    const parsed = parseSessionResponse({
      ...sessionPayload(),
      user: { ...USER, displayName: "Ada" },
    });

    expect(parsed).toEqual({
      ...makeSession(),
      user: { ...USER, displayName: "Ada" },
    });
  });

  it("rejects a payload without tokens", () => {
    expect(() =>
      parseSessionResponse({ user: USER, accessToken: "" }),
    ).toThrow();
  });
});

describe("stored session", () => {
  it("round-trips through MMKV", () => {
    persistSession(makeSession());

    expect(JSON.parse(mmkv.getString(SESSION_KEY) ?? "")).toEqual(
      makeSession(),
    );
    expect(loadStoredSession()).toEqual(makeSession());
  });

  it("removes the stored session", () => {
    persistSession(makeSession());
    persistSession(null);

    expect(mmkv.getString(SESSION_KEY)).toBeUndefined();
    expect(loadStoredSession()).toBeNull();
  });

  it("discards unreadable JSON", () => {
    mmkv.set(SESSION_KEY, "{not-json");
    expect(loadStoredSession()).toBeNull();
  });

  it("discards a session whose refresh token has expired", () => {
    persistSession(makeSession({ refreshExpiresAt: NOW - 1 }));
    expect(loadStoredSession()).toBeNull();
  });
});

describe("ensureAccessToken", () => {
  it("returns null while signed out", async () => {
    await expect(ensureAccessToken()).resolves.toBeNull();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("returns a valid access token without a refresh", async () => {
    authActions.setSession(makeSession());

    await expect(ensureAccessToken()).resolves.toBe("access-1");
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("refreshes a token that is inside the skew window", async () => {
    authActions.setSession(makeSession({ expiresAt: NOW + 30_000 }));
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse(
        sessionPayload({ accessToken: "access-2", refreshToken: "refresh-2" }),
      ),
    );

    await expect(ensureAccessToken()).resolves.toBe("access-2");
    expect(fetchWithRetry).toHaveBeenCalledWith(
      "https://worker.test/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refreshToken: "refresh-1" }),
      }),
    );
  });
});

describe("refreshSession", () => {
  it("persists the rotated refresh token and mirrors it", async () => {
    authActions.setSession(makeSession({ expiresAt: NOW + 1_000 }));
    const rotated = sessionPayload({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    vi.mocked(fetchWithRetry).mockResolvedValue(jsonResponse(rotated));

    await expect(refreshSession()).resolves.toBe("access-2");

    expect(auth$.session.peek()).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    expect(JSON.parse(mmkv.getString(SESSION_KEY) ?? "")).toMatchObject({
      refreshToken: "refresh-2",
    });
    expect(mirrorSessionToSharedContainer).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-2" }),
      expect.any(Object),
    );
  });

  it("clears the stored session when the worker rejects the token", async () => {
    authActions.setSession(makeSession({ expiresAt: NOW + 1_000 }));
    vi.mocked(fetchWithRetry).mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(refreshSession()).resolves.toBeNull();

    expect(auth$.session.peek()).toBeNull();
    expect(mmkv.getString(SESSION_KEY)).toBeUndefined();
    expect(mirrorSessionToSharedContainer).toHaveBeenCalledWith(
      null,
      expect.any(Object),
    );
  });

  it("clears an already expired refresh token without a request", async () => {
    authActions.setSession(makeSession({ refreshExpiresAt: NOW - 1 }));

    await expect(refreshSession()).resolves.toBeNull();

    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(auth$.session.peek()).toBeNull();
    expect(mmkv.getString(SESSION_KEY)).toBeUndefined();
  });

  it("coalesces concurrent refreshes into one request", async () => {
    authActions.setSession(makeSession({ expiresAt: NOW + 1_000 }));
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse(sessionPayload({ accessToken: "access-2" })),
    );

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(a).toBe("access-2");
    expect(b).toBe("access-2");
    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch", () => {
  it("retries once with a fresh token after a 401", async () => {
    authActions.setSession(makeSession());
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse(sessionPayload({ accessToken: "access-2" })),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const response = await apiFetch("/usage");

    expect(response.status).toBe(200);
    expect(fetchWithRetry).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetchWithRetry).mock.calls[2][1]).toMatchObject({
      headers: { Authorization: "Bearer access-2" },
    });
  });

  it("fails when the worker URL is missing", async () => {
    vi.mocked(getWorkerUrl).mockReturnValue("");

    await expect(apiFetch("/usage")).rejects.toMatchObject({
      code: "NO_WORKER_URL",
    });
  });
});

describe("apiJson", () => {
  it("surfaces the worker error code and message", async () => {
    authActions.setSession(makeSession());
    vi.mocked(fetchWithRetry).mockResolvedValue(
      jsonResponse({ error: "rate_limited", message: "Slow down" }, 429),
    );

    const promise = apiJson("/usage");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Slow down",
    });
  });
});
