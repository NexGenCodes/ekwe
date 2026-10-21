import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { AuthApiError } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";

import { getPosthogClient } from "@/services/posthog";
import { SyncService } from "@/services/syncService";
import { Db } from "@/services/db";
import { mmkv } from "@/services/mmkv";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { supabase, setupAppStateListener } from "@/services/supabase";
import { resetUserScopedState } from "@/store/resetUserScoped";
import {
  auth$,
  authActions,
  buildSettingsSharedPrefs,
  isDefinitelyOffline,
} from "@/store";
import { isIOS } from "@/utils";
import { track, identify, AnalyticsEvents } from "@/utils/analytics";
import logger, { addSentryBreadcrumb } from "@/utils/logger";
import { getWorkerUrl } from "@/utils/http";
import { getAppCheckToken } from "@/services/appCheck";

const SESSION_CACHE_KEY = "hasSession";
const OTP_REQUEST_TIMEOUT_MS = 15_000;
const OFFLINE_MESSAGE = "No internet connection. Please connect and try again.";

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
  needsLink?: {
    provider: "apple" | "google";
    email: string;
  };
}

type LinkProvider = "apple" | "google";

interface PendingLink {
  provider: LinkProvider;
  idToken: string;
}

let pendingLink: PendingLink | null = null;

export const getPendingLinkProvider = (): LinkProvider | null =>
  pendingLink?.provider ?? null;

function isIdentityLinkError(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  if (error.code === "user_already_exists") return true;
  return /already exists|already registered|another (provider|account)|not been linked/i.test(
    error.message,
  );
}

function safeAuthErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "over_email_send_rate_limit":
      case "rate_limit":
        return "Too many attempts. Please wait a moment and try again.";
      case "email_not_confirmed":
        return "Please confirm your email address before signing in.";
      case "otp_expired":
        return "That code expired. Request a new one and try again.";
      case "invalid_token":
      case "verification_expired":
        return "That code is no longer valid. Please request a new one.";
      case "weak_password":
        return "Please choose a stronger password.";
      case "validation_failed":
      case "invalid_credentials":
        return "The details you entered don't match. Please try again.";
      case "user_already_exists":
        return "An account already exists with this email.";
      case "email_exists":
        return "An account already exists — try signing in instead.";
      case "user_not_found":
        return "We couldn't find an account for this email.";
    }
  }
  return "That didn't work. Please try again.";
}

let _authSubscription: { unsubscribe: () => void } | null = null;

export const initAuth = async (): Promise<void> => {
  if (auth$.isInitialized.peek()) return;

  setupAppStateListener();

  try {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
  } catch (err) {
    logger.error("[Auth] GoogleSignin configure error:", err);
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    logger.info(`Auth state changed: ${event}`, session?.user?.id);
    authActions.setSession(session);
    if (event === "SIGNED_IN") {
      // A sign-in is a normal outcome; captureMessage filed it as a Sentry
      // issue on every sign-in.
      addSentryBreadcrumb("auth", "sign_in");
    } else if (event === "SIGNED_OUT") {
      addSentryBreadcrumb("auth", "sign_out");
    }
    mmkv.set(SESSION_CACHE_KEY, session !== null);

    mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());

    if (
      (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
      session?.user
    ) {
      identify(session.user.id, {
        email: session.user.email ?? "",
        is_pro: session.user.app_metadata?.is_pro === true,
      });

      if (event === "SIGNED_IN") {
        import("./notifications").then(({ registerForPushNotifications }) => {
          registerForPushNotifications().catch((err) =>
            logger.error("Failed to sync push token post-login:", err),
          );
        });
      }
      SyncService.onUserSignedIn(session.user.id);
      import("@/services/historyService")
        .then(({ HistoryService }) =>
          HistoryService.importSharedEchoHistory(session),
        )
        .catch((err: unknown) =>
          logger.error("[Auth] importSharedEchoHistory on sign-in failed", err),
        );
    }

    if (event === "SIGNED_OUT") {
      SyncService.onUserSignedOut();
      SyncService.loadInitialHistory();
    }
  });
  _authSubscription = subscription;

  authActions.setInitialized(true);

  const cachedSession = mmkv.getBoolean(SESSION_CACHE_KEY);

  if (cachedSession) {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session) {
          authActions.setSession(session);
          mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());
        } else {
          mmkv.set(SESSION_CACHE_KEY, false);
          mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
        }
      })
      .catch((err) => {
        logger.error("[Auth] Background getSession error:", err);
      });
  }

  authActions.setSessionLoaded(true);

  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.appStartTime === "number") {
    const timeToAuthInit = Date.now() - globalObj.appStartTime;
    logger.info(
      `[Performance] Startup -> Auth Init complete: ${timeToAuthInit}ms`,
    );
  }
};

export const cleanupAuth = (): void => {
  if (_authSubscription) {
    _authSubscription.unsubscribe();
    _authSubscription = null;
  }
  authActions.setInitialized(false);
};

export const sendOtp = async (email: string): Promise<AuthResult> => {
  const workerUrl = getWorkerUrl();

  if (workerUrl) {
    try {
      if (isDefinitelyOffline()) {
        track(AnalyticsEvents.AUTH_OTP_FAILED, {
          method: "otp",
          error: "network_lost",
        });
        return { ok: false, error: OFFLINE_MESSAGE };
      }

      const appCheckToken = await getAppCheckToken();

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        OTP_REQUEST_TIMEOUT_MS,
      );
      let res: Response;
      try {
        res = await fetch(`${workerUrl}/auth/otp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            ...(appCheckToken ? { appCheckToken } : {}),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        track(AnalyticsEvents.AUTH_OTP_FAILED, {
          method: "otp",
          error: `worker_${res.status}`,
        });
        if (res.status === 403) {
          return {
            ok: false,
            error: "We couldn't verify you're human. Please try again.",
          };
        }
        if (res.status === 429) {
          return {
            ok: false,
            error: "Too many requests. Please wait a moment and try again.",
          };
        }
        return {
          ok: false,
          error: "We couldn't send the code. Please try again in a moment.",
        };
      }

      track(AnalyticsEvents.AUTH_OTP_SENT, { method: "otp" });
      return { ok: true, needsOtp: true };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        track(AnalyticsEvents.AUTH_OTP_FAILED, {
          method: "otp",
          error: "timeout",
        });
        return {
          ok: false,
          error: "The request timed out. Please try again.",
        };
      }
      logger.warn("[Auth] sendOtp (worker) error:", err);
      track(AnalyticsEvents.AUTH_OTP_FAILED, {
        method: "otp",
        error: "unexpected_error",
      });
      return {
        ok: false,
        error: "We couldn't send the code. Please try again in a moment.",
      };
    }
  }

  return sendOtpDirect(email);
};

const sendOtpDirect = async (email: string): Promise<AuthResult> => {
  try {
    if (isDefinitelyOffline()) {
      return { ok: false, error: OFFLINE_MESSAGE };
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });
    if (error) {
      track(AnalyticsEvents.AUTH_OTP_FAILED, {
        method: "otp",
        error: error.message,
      });
      return { ok: false, error: safeAuthErrorMessage(error) };
    }
    track(AnalyticsEvents.AUTH_OTP_SENT, { method: "otp" });
    return { ok: true, needsOtp: true };
  } catch (err) {
    logger.warn("[Auth] sendOtp error:", err);
    track(AnalyticsEvents.AUTH_OTP_FAILED, {
      method: "otp",
      error: "unexpected_error",
    });
    return {
      ok: false,
      error: "We couldn't send the code. Please try again in a moment.",
    };
  }
};

export const verifyOtp = async (
  email: string,
  token: string,
  type: "signup" | "email" = "email",
): Promise<AuthResult> => {
  try {
    if (isDefinitelyOffline()) {
      return { ok: false, error: OFFLINE_MESSAGE };
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type,
    });
    if (error) {
      track(AnalyticsEvents.AUTH_VERIFY_FAILED, {
        method: "otp",
        type,
        error: error.message,
      });
      return { ok: false, error: safeAuthErrorMessage(error) };
    }
    if (!data.session) {
      track(AnalyticsEvents.AUTH_VERIFY_FAILED, {
        method: "otp",
        type,
        error: "no_session",
      });
      return { ok: false, error: "Verification didn't complete. Try again." };
    }

    track(
      type === "signup" ? AnalyticsEvents.SIGN_UP : AnalyticsEvents.SIGN_IN,
      { method: "otp" },
    );

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] verifyOtp error:", err);
    track(AnalyticsEvents.AUTH_VERIFY_FAILED, {
      method: "otp",
      type,
      error: "unexpected_error",
    });
    return { ok: false, error: "That code didn't match. Check and try again." };
  }
};

export const signInWithApple = async (): Promise<AuthResult> => {
  if (!isIOS) {
    return { ok: false, error: "Apple Sign In is available on iOS only." };
  }

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    const idToken = credential.identityToken;
    if (!idToken) {
      return { ok: false, error: "Apple Sign In couldn't be completed." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: idToken,
    });

    if (error) {
      const email = credential.email ?? undefined;
      if (isIdentityLinkError(error) && email) {
        pendingLink = { provider: "apple", idToken };
        track(AnalyticsEvents.AUTH_NEEDS_LINK, { method: "apple" });
        return { ok: false, needsLink: { provider: "apple", email } };
      }
      return { ok: false, error: safeAuthErrorMessage(error) };
    }

    if (credential.fullName) {
      const name = [
        credential.fullName.givenName,
        credential.fullName.familyName,
      ]
        .filter(Boolean)
        .join(" ");
      if (name) {
        await supabase.auth.updateUser({
          data: { full_name: name },
        });
      }
    }

    track(AnalyticsEvents.SIGN_IN, { method: "apple" });

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      const appleErr = err as { code: string };
      if (appleErr.code === "ERR_REQUEST_CANCELED") {
        return { ok: false };
      }
    }
    logger.error("[Auth] Apple sign-in error:", err);
    return { ok: false, error: "Apple Sign In failed. Please try again." };
  }
};

export const signInWithGoogle = async (): Promise<AuthResult> => {
  try {
    const signInResult = await GoogleSignin.signIn();

    if (signInResult.type === "cancelled") {
      return { ok: false };
    }

    const idToken =
      signInResult.type === "success" ? signInResult.data.idToken : null;

    if (!idToken) {
      return { ok: false, error: "Google Sign In couldn't be completed." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      const email =
        signInResult.type === "success"
          ? signInResult.data.user.email
          : undefined;
      if (isIdentityLinkError(error) && email) {
        pendingLink = { provider: "google", idToken };
        track(AnalyticsEvents.AUTH_NEEDS_LINK, { method: "google" });
        return { ok: false, needsLink: { provider: "google", email } };
      }
      return { ok: false, error: safeAuthErrorMessage(error) };
    }

    track(AnalyticsEvents.SIGN_IN, { method: "google" });

    return { ok: true };
  } catch (err: unknown) {
    logger.warn("[Auth] Google sign-in error:", err);
    return { ok: false, error: "Google Sign In failed. Please try again." };
  }
};

export const linkSocialIdentity = async (): Promise<AuthResult> => {
  const link = pendingLink;
  pendingLink = null;

  if (!link) {
    return {
      ok: false,
      error: "That link expired. Please sign in again.",
    };
  }

  try {
    const { error } = await supabase.auth.linkIdentity({
      provider: link.provider,
      token: link.idToken,
    });
    if (error) {
      track(AnalyticsEvents.AUTH_LINK_FAILED, {
        provider: link.provider,
        error: error.message,
      });
      return { ok: false, error: safeAuthErrorMessage(error) };
    }

    track(AnalyticsEvents.AUTH_LINKED, { provider: link.provider });
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] linkSocialIdentity error:", err);
    track(AnalyticsEvents.AUTH_LINK_FAILED, {
      provider: link.provider,
      error: "unexpected_error",
    });
    return {
      ok: false,
      error: "We couldn't link your account. Please try again.",
    };
  }
};

export const signOut = async (): Promise<AuthResult> => {
  try {
    const userId = auth$.user.get()?.id;

    if (userId) {
      await SyncService.drain();
      const remaining = Db.countUnsyncedOutbox(userId);
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

    const { error } = await supabase.auth.signOut();
    try {
      await GoogleSignin.signOut();
    } catch {
      /* ignore */
    }

    authActions.setSession(null);
    mmkv.set(SESSION_CACHE_KEY, false);
    mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
    getPosthogClient()?.reset();
    track(AnalyticsEvents.SIGN_OUT);

    if (error) return { ok: false, error: safeAuthErrorMessage(error) };
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
    const { error } = await supabase.rpc("delete_user");
    if (error) {
      logger.error("[Auth] delete_user RPC error:", error);
      return {
        ok: false,
        error: "Please contact support to complete account deletion.",
      };
    }

    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      await GoogleSignin.signOut();
    } catch {
      /* ignore */
    }
    authActions.setSession(null);
    mmkv.set(SESSION_CACHE_KEY, false);
    mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
    getPosthogClient()?.reset();
    track(AnalyticsEvents.DELETE_ACCOUNT);

    if (userId) {
      SyncService.purgeLocalHistory(userId);
    }

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] deleteAccount error:", err);
    return {
      ok: false,
      error: "Something went wrong. Please contact support for help.",
    };
  }
};
