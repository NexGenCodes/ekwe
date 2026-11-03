import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { getAppCheckToken } from "@/services/appCheck";
import {
  ApiError,
  apiFetch,
  apiJson,
  isApiError,
  loadStoredSession,
  parseSessionResponse,
  parseUserPayload,
  persistSession,
  refreshSession,
  type AuthSession,
  type AuthUser,
} from "@/services/backend";
import { Db } from "@/services/db";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { SyncService } from "@/services/syncService";
import { getPosthogClient } from "@/services/posthog";
import { auth$, authActions, buildSettingsSharedPrefs } from "@/store";
import { resetUserScopedState } from "@/store/resetUserScoped";
import { isIOS } from "@/utils";
import { AnalyticsEvents, identify, track } from "@/utils/analytics";
import logger, { addSentryBreadcrumb } from "@/utils/logger";

export type { AuthSession, AuthUser };

const OTP_REQUEST_TIMEOUT_MS = 15_000;
const OFFLINE_MESSAGE = "No internet connection. Please connect and try again.";

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
}

type SessionEvent = "boot" | "sign_in" | "sign_out";

export const initAuth = async (): Promise<void> => {
  if (auth$.isInitialized.peek()) return;

  try {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
  } catch (err) {
    logger.error("[Auth] GoogleSignin configure error:", err);
  }

  const stored = loadStoredSession();
  establishSession(stored, "boot");

  authActions.setInitialized(true);
  authActions.setSessionLoaded(true);
};

export const cleanupAuth = (): void => {
  authActions.setInitialized(false);
};

/** Applies a session to the store, persistence, the share container and sync. */
function establishSession(
  session: AuthSession | null,
  event: SessionEvent,
): void {
  authActions.setSession(session);
  persistSession(session);
  mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());

  if (!session) {
    SyncService.onUserSignedOut();
    SyncService.loadInitialHistory();
    return;
  }

  identify(session.user.id, {
    email: session.user.email,
    is_pro: session.user.tier === "PREMIUM",
  });
  SyncService.onUserSignedIn(session.user.id);

  // On boot the root layout imports the share sheet's pending captures once
  // `sessionLoaded` flips; a sign-in has to do it here.
  if (event === "sign_in") {
    addSentryBreadcrumb("auth", "sign_in");
    void import("@/services/historyService")
      .then(({ HistoryService }) =>
        HistoryService.importSharedEchoHistory(session),
      )
      .catch((err: unknown) =>
        logger.error("[Auth] importSharedEchoHistory failed", err),
      );
    void import("@/services/notifications")
      .then(({ registerForPushNotifications }) =>
        registerForPushNotifications(),
      )
      .catch((err: unknown) =>
        logger.error("[Auth] push registration failed", err),
      );
  }
}

/** Keeps the stored session in step with the store after a user change. */
function persistCurrentSession(): void {
  const session = auth$.session.peek();
  persistSession(session);
  if (session) {
    mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());
  }
}

/** Re-reads the authoritative user (and tier) from the worker. */
export const fetchSessionUser = async (): Promise<AuthUser | null> => {
  if (!auth$.session.peek()) return null;

  try {
    const body = await apiJson<{ user: unknown }>("/auth/session");
    const user = parseUserPayload(body.user);
    authActions.setUser(user);
    persistCurrentSession();
    return user;
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      establishSession(null, "sign_out");
    }
    logger.warn("[Auth] fetchSessionUser failed", err);
    return null;
  }
};

export const updateProfile = async (patch: {
  displayName?: string | null;
  avatarIcon?: string | null;
}): Promise<AuthUser | null> => {
  const body = await apiJson<{ user: unknown }>("/auth/profile", {
    method: "PATCH",
    body: patch,
  });
  const user = parseUserPayload(body.user);
  authActions.setUser(user);
  persistCurrentSession();
  return user;
};

function messageForError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return (
        err.message || "Too many requests. Please wait a moment and try again."
      );
    }
    if (err.status === 403) {
      return "We couldn't verify you're human. Please try again.";
    }
    if (err.status >= 500) {
      return "The server is having trouble. Please try again in a moment.";
    }
    return err.message || fallback;
  }
  if (err instanceof Error && err.name === "OfflineNetworkError") {
    return OFFLINE_MESSAGE;
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return "The request timed out. Please try again.";
  }
  return fallback;
}

export const sendOtp = async (email: string): Promise<AuthResult> => {
  if (!getWorkerConfigured()) {
    track(AnalyticsEvents.AUTH_OTP_FAILED, {
      method: "otp",
      error: "no_worker",
    });
    return { ok: false, error: "Sign-in is unavailable right now." };
  }

  try {
    const appCheckToken = await getAppCheckToken();
    await apiJson("/auth/otp", {
      method: "POST",
      auth: false,
      timeoutMs: OTP_REQUEST_TIMEOUT_MS,
      retries: 1,
      body: {
        email: email.trim(),
        ...(appCheckToken ? { appCheckToken } : {}),
      },
    });
    track(AnalyticsEvents.AUTH_OTP_SENT, { method: "otp" });
    return { ok: true, needsOtp: true };
  } catch (err) {
    track(AnalyticsEvents.AUTH_OTP_FAILED, {
      method: "otp",
      error: err instanceof ApiError ? err.code : "unexpected_error",
    });
    return {
      ok: false,
      error: messageForError(
        err,
        "We couldn't send the code. Please try again in a moment.",
      ),
    };
  }
};

export const verifyOtp = async (
  email: string,
  code: string,
): Promise<AuthResult> => {
  try {
    const raw = await apiJson("/auth/verify", {
      method: "POST",
      auth: false,
      body: { email: email.trim(), code: code.trim() },
    });
    establishSession(parseSessionResponse(raw), "sign_in");
    track(AnalyticsEvents.SIGN_IN, { method: "otp" });
    return { ok: true };
  } catch (err) {
    track(AnalyticsEvents.AUTH_VERIFY_FAILED, {
      method: "otp",
      error: err instanceof ApiError ? err.code : "unexpected_error",
    });
    return {
      ok: false,
      error: messageForError(
        err,
        "That code didn't match. Check and try again.",
      ),
    };
  }
};

export const signInWithApple = async (): Promise<AuthResult> => {
  if (!isIOS) {
    return { ok: false, error: "Apple Sign In is available on iOS only." };
  }

  try {
    // The worker compares sha256(nonce) against the token's claim, so the same
    // raw nonce has to reach both Apple and the backend.
    const nonce = Crypto.randomUUID();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });

    const identityToken = credential.identityToken;
    if (!identityToken) {
      return { ok: false, error: "Apple Sign In couldn't be completed." };
    }

    const fullName = credential.fullName
      ? [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean)
          .join(" ")
      : "";

    const raw = await apiJson("/auth/apple", {
      method: "POST",
      auth: false,
      body: {
        identityToken,
        nonce,
        ...(fullName ? { fullName } : {}),
      },
    });
    establishSession(parseSessionResponse(raw), "sign_in");
    track(AnalyticsEvents.SIGN_IN, { method: "apple" });
    return { ok: true };
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { code?: string }).code === "ERR_REQUEST_CANCELED"
    ) {
      return { ok: false };
    }
    logger.error("[Auth] Apple sign-in error:", err);
    return { ok: false, error: "Apple Sign In failed. Please try again." };
  }
};

export const signInWithGoogle = async (): Promise<AuthResult> => {
  try {
    const result = await GoogleSignin.signIn();
    if (result.type === "cancelled") return { ok: false };

    const idToken = result.type === "success" ? result.data.idToken : null;
    if (!idToken) {
      return { ok: false, error: "Google Sign In couldn't be completed." };
    }

    const raw = await apiJson("/auth/google", {
      method: "POST",
      auth: false,
      body: { idToken },
    });
    establishSession(parseSessionResponse(raw), "sign_in");
    track(AnalyticsEvents.SIGN_IN, { method: "google" });
    return { ok: true };
  } catch (err) {
    track(AnalyticsEvents.AUTH_VERIFY_FAILED, {
      method: "google",
      error: err instanceof ApiError ? err.code : "unexpected_error",
    });
    logger.warn("[Auth] Google sign-in error:", err);
    return {
      ok: false,
      error: messageForError(err, "Google Sign In failed. Please try again."),
    };
  }
};

export const signOut = async (): Promise<AuthResult> => {
  try {
    const userId = auth$.user.get()?.id;

    if (userId) {
      await SyncService.pushPending();
      const remaining = Db.countDirtyHistory(userId);
      if (remaining === 0) {
        SyncService.purgeLocalHistory(userId);
        SyncService.clearSyncCursor(userId);
      } else {
        logger.warn(
          "[Auth] signOut: keeping local history;",
          remaining,
          "unsynced rows could not be pushed",
        );
      }
    }

    resetUserScopedState();

    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (err) {
      logger.warn("[Auth] logout request failed", err);
    }
    try {
      await GoogleSignin.signOut();
    } catch {
      // Google may not have a session to clear.
    }

    establishSession(null, "sign_out");
    getPosthogClient()?.reset();
    track(AnalyticsEvents.SIGN_OUT);

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] signOut error:", err);
    return {
      ok: false,
      error: "Something unexpected happened. Please try again.",
    };
  }
};

export const deleteAccount = async (): Promise<AuthResult> => {
  try {
    const userId = auth$.user.get()?.id;
    await apiFetch("/auth/account", { method: "DELETE" });

    try {
      await GoogleSignin.signOut();
    } catch {
      // Google may not have a session to clear.
    }

    establishSession(null, "sign_out");
    getPosthogClient()?.reset();
    track(AnalyticsEvents.DELETE_ACCOUNT);

    if (userId) SyncService.purgeLocalHistory(userId);

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] deleteAccount error:", err);
    return {
      ok: false,
      error: isApiError(err)
        ? messageForError(
            err,
            "Please contact support to complete account deletion.",
          )
        : "Something went wrong. Please contact support for help.",
    };
  }
};

export { refreshSession };

function getWorkerConfigured(): boolean {
  return !!process.env.EXPO_PUBLIC_WORKER_URL;
}
