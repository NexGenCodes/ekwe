import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth$, authActions, networkActions } from "@/store";

import {
  cleanupAuth,
  deleteAccount,
  getPendingLinkProvider,
  initAuth,
  linkSocialIdentity,
  sendOtp,
  signInWithApple,
  signInWithGoogle,
  signOut,
  verifyOtp,
} from "@/services/auth";

const authMock = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithIdToken: vi.fn(),
  linkIdentity: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}));
const setupAppStateListenerMock = vi.hoisted(() => vi.fn());

const googleSigninMock = vi.hoisted(() => ({
  configure: vi.fn(),
  signIn: vi.fn(),
  getTokens: vi.fn(),
  signOut: vi.fn(),
}));

const appleSignInAsyncMock = vi.hoisted(() => vi.fn());

const mmkvMock = vi.hoisted(() => ({
  getString: vi.fn(),
  set: vi.fn(),
  getBoolean: vi.fn(),
  getAllKeys: vi.fn(() => [] as string[]),
  remove: vi.fn(),
}));

const syncMock = vi.hoisted(() => ({
  onUserSignedIn: vi.fn(),
  onUserSignedOut: vi.fn(),
  loadInitialHistory: vi.fn(),
  drain: vi.fn(),
  purgeLocalHistory: vi.fn(),
  clearSyncCursor: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  countUnsyncedOutbox: vi.fn<() => number>(() => 0),
}));

const posthogClientMock = vi.hoisted(() => ({ reset: vi.fn() }));

const historyServiceMock = vi.hoisted(() => ({
  importSharedEchoHistory: vi.fn(async () => undefined),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const trackMock = vi.hoisted(() => vi.fn());
const identifyMock = vi.hoisted(() => vi.fn());
const registerPushMock = vi.hoisted(() => vi.fn(async () => "push-token"));
const utilsState = vi.hoisted(() => ({ isIOS: true }));

vi.mock("@/services/supabase", () => ({
  supabase: { auth: authMock, rpc: authMock.rpc },
  setupAppStateListener: setupAppStateListenerMock,
}));

vi.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: googleSigninMock,
}));

vi.mock("expo-apple-authentication", () => ({
  signInAsync: appleSignInAsyncMock,
  AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
}));

vi.mock("@/services/mmkv", () => ({ mmkv: mmkvMock }));

vi.mock("@/services/syncService", () => ({ SyncService: syncMock }));

vi.mock("@/services/db", () => ({ Db: dbMock }));

vi.mock("@/services/posthog", () => ({
  getPosthogClient: vi.fn(() => posthogClientMock),
}));

vi.mock("@/services/sharedContainer", () => ({
  mirrorSessionToSharedContainer: vi.fn(),
  mirrorSettingsToShared: vi.fn(),
}));

vi.mock("@/services/appCheck", () => ({
  getAppCheckToken: vi.fn(async () => "app-check-token"),
}));

vi.mock("@/services/notifications", () => ({
  registerForPushNotifications: registerPushMock,
}));

vi.mock("@/services/historyService", () => ({
  HistoryService: historyServiceMock,
}));

vi.mock("@/utils/logger", () => ({
  default: loggerMock,
  addSentryBreadcrumb: vi.fn(),
  setSentryUser: vi.fn(),
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn(() => "https://worker.test"),
}));

vi.mock("@/utils/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/analytics")>();
  return { ...actual, track: trackMock, identify: identifyMock };
});

vi.mock("@/utils", () => ({
  get isIOS() {
    return utilsState.isIOS;
  },
}));

import { AnalyticsEvents } from "@/utils/analytics";
import { setupAppStateListener } from "@/services/supabase";
import { getWorkerUrl } from "@/utils/http";

function makeSession(
  userId = "user-1",
  isProValue?: boolean,
): Record<string, unknown> {
  return {
    access_token: "access-token-123",
    refresh_token: "refresh-token-123",
    user: {
      id: userId,
      email: "a@b.com",
      app_metadata: { is_pro: isProValue },
    },
  };
}

let listenerCb: ((event: string, session: unknown) => void) | null = null;
let subscription: { unsubscribe: () => void } = { unsubscribe: vi.fn() };

const flushMicrotasks = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  vi.resetAllMocks();
  authActions.setSession(null);
  authActions.setIsPro(false);
  authActions.setEntitlementSynced(false);
  authActions.setInitialized(false);
  authActions.setSessionLoaded(false);
  networkActions.set({ isConnected: null, isInternetReachable: null });
  utilsState.isIOS = true;

  authMock.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  authMock.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  authMock.verifyOtp.mockResolvedValue({
    data: { session: makeSession() },
    error: null,
  });
  authMock.signInWithIdToken.mockResolvedValue({
    data: { user: null },
    error: null,
  });
  authMock.linkIdentity.mockResolvedValue({ data: {}, error: null });
  authMock.updateUser.mockResolvedValue({ data: { user: null }, error: null });
  authMock.signOut.mockResolvedValue({ error: null });
  authMock.rpc.mockResolvedValue({ data: null, error: null });

  vi.mocked(getWorkerUrl).mockReturnValue("https://worker.test");
  registerPushMock.mockResolvedValue("push-token");
  historyServiceMock.importSharedEchoHistory.mockResolvedValue(undefined);

  mmkvMock.getBoolean.mockReturnValue(undefined);
  mmkvMock.getString.mockReturnValue(undefined);

  googleSigninMock.getTokens.mockResolvedValue({
    idToken: "google-id-token",
    accessToken: "google-access-token",
  });
  appleSignInAsyncMock.mockResolvedValue({
    identityToken: "apple-id-token",
  });

  authMock.onAuthStateChange.mockImplementation(
    (cb: (event: string, session: unknown) => void) => {
      listenerCb = cb;
      subscription = { unsubscribe: vi.fn() };
      return { data: { subscription } };
    },
  );

  await linkSocialIdentity();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("initAuth", () => {
  it("returns immediately when already initialized", async () => {
    authActions.setInitialized(true);
    await initAuth();
    expect(setupAppStateListener).not.toHaveBeenCalled();
    expect(googleSigninMock.configure).not.toHaveBeenCalled();
  });

  it("configures the listener, google sign-in, and marks initialized", async () => {
    await initAuth();

    expect(setupAppStateListener).toHaveBeenCalledTimes(1);
    expect(googleSigninMock.configure).toHaveBeenCalledWith({
      webClientId: undefined,
      iosClientId: undefined,
    });
    expect(authMock.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(auth$.isInitialized.peek()).toBe(true);
    expect(auth$.sessionLoaded.peek()).toBe(true);
  });

  it("restores a cached session from mmkv while the background refresh is pending", async () => {
    mmkvMock.getBoolean.mockReturnValue(true);
    mmkvMock.getString.mockReturnValue(
      JSON.stringify(makeSession("cached-user")),
    );

    authMock.getSession.mockImplementation(() => new Promise(() => {}));
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");

    await initAuth();

    expect(mmkvMock.getString).toHaveBeenCalledWith("sb-abc-auth-token");
    expect(auth$.session.peek()?.user?.id).toBe("cached-user");
    expect(auth$.sessionLoaded.peek()).toBe(true);
  });

  it("clears the cached flag when the background refresh finds no session", async () => {
    mmkvMock.getBoolean.mockReturnValue(true);
    mmkvMock.getString.mockReturnValue(
      JSON.stringify(makeSession("cached-user")),
    );
    authActions.setSession(null);
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");

    await initAuth();
    await flushMicrotasks();

    expect(mmkvMock.set).toHaveBeenCalledWith("hasSession", false);
    expect(auth$.sessionLoaded.peek()).toBe(true);
  });
});

describe("auth state change handler", () => {
  beforeEach(async () => {
    await initAuth();
  });

  it("handles SIGNED_IN by identifying, registering push, and importing share history", async () => {
    const session = makeSession("u1") as never;
    listenerCb?.("SIGNED_IN", session);

    await flushMicrotasks();

    expect(identifyMock).toHaveBeenCalledWith("u1", {
      email: "a@b.com",
      is_pro: false,
    });
    expect(registerPushMock).toHaveBeenCalledTimes(1);
    expect(syncMock.onUserSignedIn).toHaveBeenCalledWith("u1");
    expect(historyServiceMock.importSharedEchoHistory).toHaveBeenCalledWith(
      session,
    );
  });

  it("registers the push token only for SIGNED_IN, not INITIAL_SESSION", async () => {
    listenerCb?.("INITIAL_SESSION", makeSession("u1") as never);
    await flushMicrotasks();

    expect(identifyMock).toHaveBeenCalledWith("u1", expect.anything());
    expect(registerPushMock).not.toHaveBeenCalled();
    expect(historyServiceMock.importSharedEchoHistory).toHaveBeenCalledTimes(1);
  });

  it("invalidates caches and reloads history on SIGNED_OUT", async () => {
    listenerCb?.("SIGNED_OUT", null);
    await flushMicrotasks();

    expect(syncMock.onUserSignedOut).toHaveBeenCalled();
    expect(syncMock.loadInitialHistory).toHaveBeenCalled();
    expect(mmkvMock.set).toHaveBeenCalledWith("hasSession", false);
    expect(syncMock.onUserSignedIn).not.toHaveBeenCalled();
  });
});

describe("cleanupAuth", () => {
  it("unsubscribes and resets the initialized flag", async () => {
    await initAuth();
    const before = subscription;
    cleanupAuth();
    expect(before.unsubscribe).toHaveBeenCalled();
    expect(auth$.isInitialized.peek()).toBe(false);
  });
});

describe("sendOtp", () => {
  it("fails fast while offline through the worker", async () => {
    networkActions.set({ isConnected: false, isInternetReachable: false });
    const result = await sendOtp("  user@example.com  ");
    expect(result).toEqual({
      ok: false,
      error: "No internet connection. Please connect and try again.",
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_OTP_FAILED, {
      method: "otp",
      error: "network_lost",
    });
  });

  it("sends the code via the worker", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const result = await sendOtp("  user@example.com  ");

    expect(result).toEqual({ ok: true, needsOtp: true });
    expect(fetchSpy).toHaveBeenCalledWith("https://worker.test/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "user@example.com",
        appCheckToken: "app-check-token",
      }),
      signal: expect.any(AbortSignal),
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_OTP_SENT, {
      method: "otp",
    });
  });

  it("surfaces a 403 bot-verification failure", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    const result = await sendOtp("user@example.com");
    expect(result).toEqual({
      ok: false,
      error: "We couldn't verify you're human. Please try again.",
    });
    fetchSpy.mockRestore();
  });

  it("surfaces a 429 rate limit", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 429 }));
    const result = await sendOtp("user@example.com");
    expect(result).toEqual({
      ok: false,
      error: "Too many requests. Please wait a moment and try again.",
    });
    fetchSpy.mockRestore();
  });

  it("reports an abort as a timeout", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, opts) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const e = new Error("Aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const promise = sendOtp("user@example.com");

    await Promise.resolve();
    vi.advanceTimersByTime(16_000);
    const result = await promise;
    expect(result).toEqual({
      ok: false,
      error: "The request timed out. Please try again.",
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_OTP_FAILED, {
      method: "otp",
      error: "timeout",
    });
    fetchSpy.mockRestore();
  });

  it("falls back to Supabase directly without a worker URL", async () => {
    vi.mocked(getWorkerUrl).mockReturnValue("");
    const result = await sendOtp("user@example.com");
    expect(result).toEqual({ ok: true, needsOtp: true });
    expect(authMock.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
    });
  });

  it("maps a direct sign-in error to safe copy", async () => {
    vi.mocked(getWorkerUrl).mockReturnValue("");
    authMock.signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    });
    const result = await sendOtp("user@example.com");
    expect(result).toEqual({
      ok: false,
      error: "The details you entered don't match. Please try again.",
    });
  });
});

describe("verifyOtp", () => {
  it("fails fast when offline", async () => {
    networkActions.set({ isConnected: false, isInternetReachable: false });
    const result = await verifyOtp("user@example.com", "123456");
    expect(result).toEqual({
      ok: false,
      error: "No internet connection. Please connect and try again.",
    });
  });

  it("maps an otp_expired error to safe copy", async () => {
    authMock.verifyOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "Token has expired or is invalid",
        400,
        "otp_expired",
      ),
    });
    const result = await verifyOtp("user@example.com", "123456");
    expect(result).toEqual({
      ok: false,
      error: "That code expired. Request a new one and try again.",
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_VERIFY_FAILED, {
      method: "otp",
      type: "email",
      error: "Token has expired or is invalid",
    });
  });

  it("reports a missing session", async () => {
    authMock.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const result = await verifyOtp("user@example.com", "123456");
    expect(result).toEqual({
      ok: false,
      error: "Verification didn't complete. Try again.",
    });
  });

  it("tracks a sign-in on success", async () => {
    const result = await verifyOtp("user@example.com", "123456");
    expect(result).toEqual({ ok: true });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.SIGN_IN, {
      method: "otp",
    });
  });

  it("tracks a sign-up for the signup type", async () => {
    const result = await verifyOtp("user@example.com", "123456", "signup");
    expect(result).toEqual({ ok: true });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.SIGN_UP, {
      method: "otp",
    });
  });

  it("returns a neutral message on an unexpected throw", async () => {
    authMock.verifyOtp.mockRejectedValue(new Error("boom"));
    const result = await verifyOtp("user@example.com", "123456");
    expect(result).toEqual({
      ok: false,
      error: "That code didn't match. Check and try again.",
    });
  });
});

describe("signInWithApple", () => {
  it("rejects on non-iOS platforms", async () => {
    utilsState.isIOS = false;
    const result = await signInWithApple();
    expect(result).toEqual({
      ok: false,
      error: "Apple Sign In is available on iOS only.",
    });
    expect(appleSignInAsyncMock).not.toHaveBeenCalled();
  });

  it("rejects when no identity token is returned", async () => {
    appleSignInAsyncMock.mockResolvedValue({ identityToken: null });
    const result = await signInWithApple();
    expect(result).toEqual({
      ok: false,
      error: "Apple Sign In couldn't be completed.",
    });
  });

  it("offers the email-link flow when the social account already exists", async () => {
    appleSignInAsyncMock.mockResolvedValue({
      identityToken: "apple-id-token",
      email: "existing@example.com",
    });
    authMock.signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "User already registered",
        400,
        "user_already_exists",
      ),
    });

    const result = await signInWithApple();
    expect(result).toEqual({
      ok: false,
      needsLink: { provider: "apple", email: "existing@example.com" },
    });
    expect(getPendingLinkProvider()).toBe("apple");
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_NEEDS_LINK, {
      method: "apple",
    });
  });

  it("maps a non-link error to safe copy", async () => {
    appleSignInAsyncMock.mockResolvedValue({ identityToken: "apple-id-token" });
    authMock.signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    });
    const result = await signInWithApple();
    expect(result).toEqual({
      ok: false,
      error: "The details you entered don't match. Please try again.",
    });
  });

  it("succeeds without a full name", async () => {
    const result = await signInWithApple();
    expect(result).toEqual({ ok: true });
    expect(authMock.updateUser).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.SIGN_IN, {
      method: "apple",
    });
  });

  it("updates the user's full name when provided", async () => {
    appleSignInAsyncMock.mockResolvedValue({
      identityToken: "apple-id-token",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
    });
    const result = await signInWithApple();
    expect(result).toEqual({ ok: true });
    expect(authMock.updateUser).toHaveBeenCalledWith({
      data: { full_name: "Ada Lovelace" },
    });
  });

  it("returns ok:false silently when the user cancels", async () => {
    appleSignInAsyncMock.mockRejectedValue(
      Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }),
    );
    const result = await signInWithApple();
    expect(result).toEqual({ ok: false, error: undefined });
  });

  it("returns a safe message on an unexpected failure", async () => {
    appleSignInAsyncMock.mockRejectedValue(new Error("boom"));
    const result = await signInWithApple();
    expect(result).toEqual({
      ok: false,
      error: "Apple Sign In failed. Please try again.",
    });
  });
});

describe("signInWithGoogle", () => {
  it("returns ok:false silently when the user cancels", async () => {
    googleSigninMock.signIn.mockResolvedValue({ type: "cancelled" });
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: false, error: undefined });
    expect(googleSigninMock.getTokens).not.toHaveBeenCalled();
  });

  it("rejects when no id token is returned", async () => {
    googleSigninMock.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: null, user: { email: "a@b.com" } },
    });
    const result = await signInWithGoogle();
    expect(result).toEqual({
      ok: false,
      error: "Google Sign In couldn't be completed.",
    });
  });

  it("offers the email-link flow when the social account already exists", async () => {
    googleSigninMock.signIn.mockResolvedValue({
      type: "success",
      data: {
        idToken: "google-id-token",
        user: { email: "existing@example.com" },
      },
    });
    authMock.signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "User already registered",
        400,
        "user_already_exists",
      ),
    });
    const result = await signInWithGoogle();
    expect(result).toEqual({
      ok: false,
      needsLink: { provider: "google", email: "existing@example.com" },
    });
    expect(getPendingLinkProvider()).toBe("google");
  });

  it("succeeds", async () => {
    googleSigninMock.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: "google-id-token", user: { email: "a@b.com" } },
    });
    const result = await signInWithGoogle();
    expect(result).toEqual({ ok: true });
    expect(googleSigninMock.getTokens).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.SIGN_IN, {
      method: "google",
    });
  });

  it("returns a safe message on an unexpected failure", async () => {
    googleSigninMock.signIn.mockRejectedValue(new Error("boom"));
    const result = await signInWithGoogle();
    expect(result).toEqual({
      ok: false,
      error: "Google Sign In failed. Please try again.",
    });
  });
});

describe("linkSocialIdentity", () => {
  it("expires when no link is pending", async () => {
    const result = await linkSocialIdentity();
    expect(result).toEqual({
      ok: false,
      error: "That link expired. Please sign in again.",
    });
  });

  it("links a pending provider", async () => {
    googleSigninMock.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: "google-id-token", user: { email: "x@y.com" } },
    });
    authMock.signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "User already registered",
        400,
        "user_already_exists",
      ),
    });
    await signInWithGoogle();
    expect(getPendingLinkProvider()).toBe("google");

    const result = await linkSocialIdentity();
    expect(result).toEqual({ ok: true });
    expect(authMock.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_LINKED, {
      provider: "google",
    });
  });

  it("maps a link failure to safe copy", async () => {
    googleSigninMock.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: "google-id-token", user: { email: "x@y.com" } },
    });
    authMock.signInWithIdToken.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "User already registered",
        400,
        "user_already_exists",
      ),
    });
    await signInWithGoogle();

    authMock.linkIdentity.mockResolvedValue({
      data: {},
      error: new AuthApiError("Failed", 400, "validation_failed"),
    });
    const result = await linkSocialIdentity();
    expect(result).toEqual({
      ok: false,
      error: "The details you entered don't match. Please try again.",
    });
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.AUTH_LINK_FAILED, {
      provider: "google",
      error: "Failed",
    });
  });
});

describe("signOut", () => {
  it("signs out and clears local state", async () => {
    authActions.setSession(makeSession("u1") as never);
    const result = await signOut();

    expect(result).toEqual({ ok: true });
    expect(syncMock.drain).toHaveBeenCalled();
    expect(syncMock.purgeLocalHistory).toHaveBeenCalledWith("u1");
    expect(syncMock.clearSyncCursor).toHaveBeenCalledWith("u1");
    expect(authMock.signOut).toHaveBeenCalled();
    expect(googleSigninMock.signOut).toHaveBeenCalled();
    expect(mmkvMock.set).toHaveBeenCalledWith("hasSession", false);
    expect(posthogClientMock.reset).toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.SIGN_OUT);
  });

  it("keeps local history when the outbox still has rows", async () => {
    authActions.setSession(makeSession("u1") as never);
    dbMock.countUnsyncedOutbox.mockReturnValue(1);
    const result = await signOut();
    expect(result).toEqual({ ok: true });
    expect(syncMock.purgeLocalHistory).not.toHaveBeenCalled();
    expect(syncMock.clearSyncCursor).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("keeps local history when rows are dead and no longer retry-eligible", async () => {
    authActions.setSession(makeSession("u1") as never);
    dbMock.countUnsyncedOutbox.mockReturnValue(3);
    await signOut();
    expect(syncMock.purgeLocalHistory).not.toHaveBeenCalled();
    expect(syncMock.clearSyncCursor).not.toHaveBeenCalled();
  });

  it("waits for the outbox to flush before deciding to purge", async () => {
    authActions.setSession(makeSession("u1") as never);
    const order: string[] = [];
    syncMock.drain.mockImplementation(async () => {
      await Promise.resolve();
      order.push("drained");
      dbMock.countUnsyncedOutbox.mockReturnValue(0);
    });
    dbMock.countUnsyncedOutbox.mockReturnValue(1);

    await signOut();

    expect(order).toEqual(["drained"]);
    expect(syncMock.purgeLocalHistory).toHaveBeenCalledWith("u1");
  });

  it("still clears local state when the sign-out call fails", async () => {
    authActions.setSession(makeSession("u1") as never);
    authMock.signOut.mockResolvedValue({
      error: new AuthApiError("Network", 500, "unknown"),
    });
    const result = await signOut();
    expect(result).toEqual({
      ok: false,
      error: "That didn't work. Please try again.",
    });
  });
});

describe("deleteAccount", () => {
  it("does not delete locally when the RPC fails", async () => {
    authActions.setSession(makeSession("u1") as never);
    authMock.rpc.mockResolvedValue({
      data: null,
      error: new Error("rpc denied"),
    });
    const result = await deleteAccount();
    expect(result).toEqual({
      ok: false,
      error: "Please contact support to complete account deletion.",
    });
    expect(syncMock.purgeLocalHistory).not.toHaveBeenCalled();
  });

  it("deletes the account and purges local history", async () => {
    authActions.setSession(makeSession("u1") as never);
    const result = await deleteAccount();
    expect(result).toEqual({ ok: true });
    expect(authMock.rpc).toHaveBeenCalledWith("delete_user");
    expect(syncMock.purgeLocalHistory).toHaveBeenCalledWith("u1");
    expect(posthogClientMock.reset).toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(AnalyticsEvents.DELETE_ACCOUNT);
  });

  it("returns a support message on an unexpected failure", async () => {
    authMock.rpc.mockRejectedValue(new Error("boom"));
    const result = await deleteAccount();
    expect(result).toEqual({
      ok: false,
      error: "Something went wrong. Please contact support for help.",
    });
  });
});
