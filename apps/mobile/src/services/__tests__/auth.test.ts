import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/store/auth";

vi.mock("@/services/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backend")>();
  return { ...actual, apiJson: vi.fn(), apiFetch: vi.fn() };
});

vi.mock("@/services/appCheck", () => ({
  getAppCheckToken: vi.fn(async () => null),
}));

vi.mock("@/services/sharedContainer", () => ({
  mirrorSessionToSharedContainer: vi.fn(),
  mirrorSettingsToShared: vi.fn(),
}));

vi.mock("@/services/syncService", () => ({
  SyncService: {
    onUserSignedIn: vi.fn(),
    onUserSignedOut: vi.fn(),
    loadInitialHistory: vi.fn(),
    drain: vi.fn(async () => undefined),
    purgeLocalHistory: vi.fn(),
    clearSyncCursor: vi.fn(),
  },
}));

vi.mock("@/services/historyService", () => ({
  HistoryService: { importSharedEchoHistory: vi.fn(async () => undefined) },
}));

vi.mock("@/services/notifications", () => ({
  registerForPushNotifications: vi.fn(async () => undefined),
}));

vi.mock("@/services/posthog", () => ({
  getPosthogClient: vi.fn(() => null),
}));

vi.mock("@/store/resetUserScoped", () => ({
  resetUserScopedState: vi.fn(),
}));

vi.mock("@/utils/analytics", () => ({
  AnalyticsEvents: new Proxy({}, { get: (_t, key) => String(key) }),
  identify: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  addSentryBreadcrumb: vi.fn(),
  setSentryUser: vi.fn(),
}));

vi.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => undefined),
  },
}));

vi.mock("expo-apple-authentication", () => ({
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { getAppCheckToken } from "@/services/appCheck";
import { apiFetch, apiJson, ApiError } from "@/services/backend";
import { Db } from "@/services/db";
import {
  deleteAccount,
  fetchSessionUser,
  initAuth,
  sendOtp,
  signInWithApple,
  signInWithGoogle,
  signOut,
  updateProfile,
  verifyOtp,
} from "@/services/auth";
import { SyncService } from "@/services/syncService";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { auth$, authActions } from "@/store/auth";

const NOW = Date.now();

const user = {
  id: "u1",
  email: "person@ekwe.app",
  tier: "FREE" as const,
  displayName: null,
  avatarUrl: null,
  avatarIcon: null,
  proExpiresAt: null,
};

const sessionResponse = {
  user,
  accessToken: "access",
  expiresAt: NOW + 1_800_000,
  refreshToken: "refresh",
  refreshExpiresAt: NOW + 2_592_000_000,
};

function signedIn(tier: "FREE" | "PREMIUM" = "FREE"): void {
  const session: AuthSession = {
    ...sessionResponse,
    user: { ...user, tier },
  };
  authActions.setSession(session);
}

function mockRoutes(routes: Record<string, unknown>): void {
  vi.mocked(apiJson).mockImplementation(async (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected request: ${path}`);
    const value = routes[path];
    if (value instanceof Error) throw value;
    return value as never;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  authActions.setSession(null);
  authActions.setInitialized(false);
  authActions.setSessionLoaded(false);
  vi.stubEnv("EXPO_PUBLIC_WORKER_URL", "https://worker.test");
  vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
  vi.spyOn(Db, "countUnsyncedOutbox").mockReturnValue(0);
});

describe("initAuth", () => {
  it("configures Google and marks the session loaded", async () => {
    await initAuth();

    expect(GoogleSignin.configure).toHaveBeenCalled();
    expect(auth$.isInitialized.peek()).toBe(true);
    expect(auth$.sessionLoaded.peek()).toBe(true);
  });

  it("is idempotent", async () => {
    await initAuth();
    await initAuth();

    expect(GoogleSignin.configure).toHaveBeenCalledTimes(1);
  });
});

describe("sendOtp", () => {
  it("asks the worker for a code", async () => {
    mockRoutes({ "/auth/otp": { ok: true } });

    const result = await sendOtp(" Person@Ekwe.app ");

    expect(result).toEqual({ ok: true, needsOtp: true });
    expect(apiJson).toHaveBeenCalledWith(
      "/auth/otp",
      expect.objectContaining({
        method: "POST",
        auth: false,
        body: expect.objectContaining({ email: "Person@Ekwe.app" }),
      }),
    );
  });

  it("maps a bot-verification rejection", async () => {
    mockRoutes({
      "/auth/otp": new ApiError(403, "turnstile_failed", "nope"),
    });

    const result = await sendOtp("person@ekwe.app");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/verify you're human/i);
  });

  it("maps a rate limit", async () => {
    mockRoutes({
      "/auth/otp": new ApiError(429, "rate_limited", "Too many requests"),
    });

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({ ok: false, error: "Too many requests" });
  });

  it("maps a server error to a retry message", async () => {
    mockRoutes({
      "/auth/otp": new ApiError(500, "server_error", "down"),
    });

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({
      ok: false,
      error: "The server is having trouble. Please try again in a moment.",
    });
  });

  it("falls back when the API error has no message", async () => {
    mockRoutes({
      "/auth/otp": new ApiError(400, "bad_request", ""),
    });

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({
      ok: false,
      error: "We couldn't send the code. Please try again in a moment.",
    });
  });

  it("maps an offline network error", async () => {
    const offline = Object.assign(new Error("offline"), {
      name: "OfflineNetworkError",
    });
    mockRoutes({ "/auth/otp": offline });

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({
      ok: false,
      error: "No internet connection. Please connect and try again.",
    });
  });

  it("maps a timeout and tracks it as unexpected", async () => {
    const timeout = Object.assign(new Error("timeout"), {
      name: "TimeoutError",
    });
    mockRoutes({ "/auth/otp": timeout });

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({
      ok: false,
      error: "The request timed out. Please try again.",
    });
  });

  it("forwards an App Check token when available", async () => {
    vi.mocked(getAppCheckToken).mockResolvedValueOnce("app-check-token");
    mockRoutes({ "/auth/otp": { ok: true } });

    await sendOtp("person@ekwe.app");

    expect(apiJson).toHaveBeenCalledWith(
      "/auth/otp",
      expect.objectContaining({
        body: expect.objectContaining({ appCheckToken: "app-check-token" }),
      }),
    );
  });

  it("fails fast without a worker URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_WORKER_URL", "");

    const result = await sendOtp("person@ekwe.app");

    expect(result).toEqual({
      ok: false,
      error: "Sign-in is unavailable right now.",
    });
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe("verifyOtp", () => {
  it("establishes the session on a valid code", async () => {
    mockRoutes({ "/auth/verify": sessionResponse });

    const result = await verifyOtp(" person@ekwe.app ", " 123456 ");

    expect(result).toEqual({ ok: true });
    expect(apiJson).toHaveBeenCalledWith(
      "/auth/verify",
      expect.objectContaining({
        body: { email: "person@ekwe.app", code: "123456" },
      }),
    );
    expect(auth$.session.peek()).toMatchObject({
      accessToken: "access",
      user: { id: "u1" },
    });
    expect(SyncService.onUserSignedIn).toHaveBeenCalledWith("u1");
  });

  it("returns the server message for an expired code", async () => {
    mockRoutes({
      "/auth/verify": new ApiError(
        400,
        "otp_expired",
        "That code has expired.",
      ),
    });

    const result = await verifyOtp("person@ekwe.app", "123456");

    expect(result).toEqual({ ok: false, error: "That code has expired." });
    expect(auth$.session.peek()).toBeNull();
  });

  it("returns a neutral message for an unexpected shape", async () => {
    mockRoutes({ "/auth/verify": { unexpected: true } });

    const result = await verifyOtp("person@ekwe.app", "123456");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/didn't match/i);
  });
});

describe("signInWithApple", () => {
  it("sends the raw nonce and the identity token", async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: "apple-token",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
    } as never);
    mockRoutes({ "/auth/apple": sessionResponse });

    const result = await signInWithApple();

    expect(result).toEqual({ ok: true });
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: expect.any(String) }),
    );
    expect(apiJson).toHaveBeenCalledWith(
      "/auth/apple",
      expect.objectContaining({
        body: expect.objectContaining({
          identityToken: "apple-token",
          nonce: expect.any(String),
          fullName: "Ada Lovelace",
        }),
      }),
    );
    expect(auth$.session.peek()?.accessToken).toBe("access");
  });

  it("stays silent when the user cancels", async () => {
    const cancel = Object.assign(new Error("canceled"), {
      code: "ERR_REQUEST_CANCELED",
    });
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue(cancel);

    const result = await signInWithApple();

    expect(result).toEqual({ ok: false });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("rejects a credential without an identity token", async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: null,
    } as never);

    const result = await signInWithApple();

    expect(result.ok).toBe(false);
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("omits an empty full name", async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: "apple-token",
      fullName: null,
    } as never);
    mockRoutes({ "/auth/apple": sessionResponse });

    await signInWithApple();

    expect(apiJson).toHaveBeenCalledWith(
      "/auth/apple",
      expect.objectContaining({
        body: { identityToken: "apple-token", nonce: expect.any(String) },
      }),
    );
  });

  it("reports a native failure", async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue(
      new Error("native failure"),
    );

    const result = await signInWithApple();

    expect(result).toEqual({
      ok: false,
      error: "Apple Sign In failed. Please try again.",
    });
  });
});

describe("signInWithGoogle", () => {
  it("exchanges the id token for a session", async () => {
    vi.mocked(GoogleSignin.signIn).mockResolvedValue({
      type: "success",
      data: { idToken: "google-token" },
    } as never);
    mockRoutes({ "/auth/google": sessionResponse });

    const result = await signInWithGoogle();

    expect(result).toEqual({ ok: true });
    expect(apiJson).toHaveBeenCalledWith(
      "/auth/google",
      expect.objectContaining({ body: { idToken: "google-token" } }),
    );
  });

  it("stays silent when the user cancels", async () => {
    vi.mocked(GoogleSignin.signIn).mockResolvedValue({
      type: "cancelled",
    } as never);

    const result = await signInWithGoogle();

    expect(result).toEqual({ ok: false });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("reports a missing id token", async () => {
    vi.mocked(GoogleSignin.signIn).mockResolvedValue({
      type: "success",
      data: { idToken: null },
    } as never);

    const result = await signInWithGoogle();

    expect(result).toEqual({
      ok: false,
      error: "Google Sign In couldn't be completed.",
    });
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("reports a provider error", async () => {
    vi.mocked(GoogleSignin.signIn).mockRejectedValue(
      new Error("play services unavailable"),
    );

    const result = await signInWithGoogle();

    expect(result).toEqual({
      ok: false,
      error: "Google Sign In failed. Please try again.",
    });
  });
});

describe("fetchSessionUser", () => {
  it("updates the stored user", async () => {
    signedIn("FREE");
    mockRoutes({ "/auth/session": { user: { ...user, tier: "PREMIUM" } } });

    const result = await fetchSessionUser();

    expect(result?.tier).toBe("PREMIUM");
    expect(auth$.isPro.peek()).toBe(true);
  });

  it("signs out when the token is rejected", async () => {
    signedIn();
    mockRoutes({
      "/auth/session": new ApiError(401, "unauthorized", "expired"),
    });

    const result = await fetchSessionUser();

    expect(result).toBeNull();
    expect(auth$.session.peek()).toBeNull();
    expect(SyncService.onUserSignedOut).toHaveBeenCalled();
  });

  it("keeps the session on a transient error", async () => {
    signedIn();
    mockRoutes({
      "/auth/session": new ApiError(500, "server_error", "down"),
    });

    const result = await fetchSessionUser();

    expect(result).toBeNull();
    expect(auth$.session.peek()).not.toBeNull();
  });

  it("returns null when signed out", async () => {
    expect(await fetchSessionUser()).toBeNull();
    expect(apiJson).not.toHaveBeenCalled();
  });
});

describe("updateProfile", () => {
  it("patches the profile and stores the result", async () => {
    signedIn();
    mockRoutes({
      "/auth/profile": { user: { ...user, avatarIcon: "star" } },
    });

    const result = await updateProfile({ avatarIcon: "star" });

    expect(apiJson).toHaveBeenCalledWith(
      "/auth/profile",
      expect.objectContaining({
        method: "PATCH",
        body: { avatarIcon: "star" },
      }),
    );
    expect(result?.avatarIcon).toBe("star");
    expect(auth$.user.peek()?.avatarIcon).toBe("star");
    expect(mirrorSessionToSharedContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ avatarIcon: "star" }),
      }),
      expect.any(Object),
    );
  });
});

describe("signOut", () => {
  it("clears local state and the server session", async () => {
    signedIn("PREMIUM");

    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(SyncService.drain).toHaveBeenCalled();
    expect(SyncService.purgeLocalHistory).toHaveBeenCalledWith("u1");
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(auth$.session.peek()).toBeNull();
  });

  it("signs out when there is no locally cached user", async () => {
    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(SyncService.drain).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps local history while rows are still queued", async () => {
    signedIn();
    vi.mocked(Db.countUnsyncedOutbox).mockReturnValueOnce(2);

    await signOut();

    expect(SyncService.purgeLocalHistory).not.toHaveBeenCalled();
    expect(SyncService.clearSyncCursor).not.toHaveBeenCalled();
    expect(auth$.session.peek()).toBeNull();
  });

  it("signs out locally even when the request fails", async () => {
    signedIn();
    vi.mocked(apiFetch).mockRejectedValue(new Error("offline"));

    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(auth$.session.peek()).toBeNull();
  });
});

describe("deleteAccount", () => {
  it("deletes the account and purges local data", async () => {
    signedIn();

    const result = await deleteAccount();

    expect(result).toEqual({ ok: true });
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/account",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(SyncService.purgeLocalHistory).toHaveBeenCalledWith("u1");
    expect(auth$.session.peek()).toBeNull();
  });

  it("keeps the session when the server refuses", async () => {
    signedIn();
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiError(409, "active_subscription", "Cancel your plan first."),
    );

    const result = await deleteAccount();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Cancel your plan first.");
    expect(auth$.session.peek()).not.toBeNull();
    expect(SyncService.purgeLocalHistory).not.toHaveBeenCalled();
  });
});
