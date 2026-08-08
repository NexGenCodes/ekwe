/**
 * Auth Service — Single source of truth for all Supabase auth operations.
 *
 * Every auth screen calls these functions instead of touching supabase.auth directly.
 * This keeps screens thin and auth logic testable + swappable.
 */
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";

import { queryClient } from "@/hooks/queries/queryClient";
import { getPosthogClient } from "@/services/posthog";
import { SyncService } from "@/services/SyncService";
import { mmkv } from "@/services/mmkv";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { supabase, setupAppStateListener } from "@/services/supabase";
import { auth$, authActions, buildSettingsSharedPrefs } from "@/store";
import { isIOS } from "@/utils";
import { track, identify, AnalyticsEvents } from "@/utils/analytics";
import logger from "@/utils/logger";

const SESSION_CACHE_KEY = "hasSession";

// ── Types ────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
}

// ── Initialization ─────────────────────────────────────────────────

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

  // Set up listener first — catches events during session recovery too
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    logger.info(`Auth state changed: ${event}`, session?.user?.id);
    authActions.setSession(session);
    mmkv.set(SESSION_CACHE_KEY, session !== null);

    // Mirror the session into the shared App Group container so the native iOS
    // share extension can authenticate without a deep-link handoff.
    mirrorSessionToSharedContainer(session, buildSettingsSharedPrefs());

    if (event === "SIGNED_IN" && session?.user) {
      identify(session.user.id, {
        email: session.user.email ?? "",
        is_pro: session.user.app_metadata?.is_pro === true,
      });
      SyncService.onUserSignedIn(session.user.id);
      // Drain any share-extension work the native share sheet completed while
      // the user was signed out (the file stays in the App Group until then).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HistoryService } = require("@/services/HistoryService");
      HistoryService.importSharedEchoHistory(session).catch((err: unknown) =>
        logger.error("[Auth] importSharedEchoHistory on sign-in failed", err),
      );
    }

    if (event === "SIGNED_OUT") {
      queryClient.invalidateQueries({ queryKey: ["translate"] });
      queryClient.invalidateQueries({ queryKey: ["transcribe"] });
    }
  });
  _authSubscription = subscription;

  // Mark initialized immediately so the UI can render past the splash
  authActions.setInitialized(true);

  // Sync read from MMKV — tells us if we need to hit SecureStore
  const cachedSession = mmkv.getBoolean(SESSION_CACHE_KEY);

  if (cachedSession) {
    try {
      // 1. Sync read directly from mmkv to instantly populate the UI
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
      const projectRef = supabaseUrl.match(
        /https:\/\/(.*?)\.supabase\.co/,
      )?.[1];
      const storageKey = projectRef
        ? `sb-${projectRef}-auth-token`
        : "supabase.auth.token";

      const rawSession = mmkv.getString(storageKey);
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        authActions.setSession(parsed);
      }

      // 2. Fire the async fetch in the background to refresh tokens
      // without blocking the splash screen!
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
    } catch (err) {
      logger.error("[Auth] MMKV session parse error:", err);
    }
  }

  authActions.setSessionLoaded(true);

  // Telemetry: measure app startup to auth ready
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

// ── OTP (Passwordless) ──────────────────────────────────────────

export const sendOtp = async (email: string): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });
    if (error) {
      track(AnalyticsEvents.AUTH_OTP_FAILED, {
        method: "otp",
        error: error.message,
      });
      return { ok: false, error: error.message };
    }
    track(AnalyticsEvents.AUTH_OTP_SENT, { method: "otp" });
    return { ok: true, needsOtp: true };
  } catch (err) {
    logger.error("[Auth] sendOtp error:", err);
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
      return { ok: false, error: error.message };
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

// ── Social: Apple ───────────────────────────────────────────────

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

    if (error) return { ok: false, error: error.message };

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

// ── Social: Google ──────────────────────────────────────────────

export const signInWithGoogle = async (): Promise<AuthResult> => {
  try {
    const signInResult = await GoogleSignin.signIn();

    if (signInResult.type === "cancelled") {
      return { ok: false };
    }

    const { idToken } = await GoogleSignin.getTokens();

    if (!idToken) {
      return { ok: false, error: "Google Sign In couldn't be completed." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) return { ok: false, error: error.message };

    track(AnalyticsEvents.SIGN_IN, { method: "google" });

    return { ok: true };
  } catch (err: unknown) {
    logger.error("[Auth] Google sign-in error:", err);
    return { ok: false, error: "Google Sign In failed. Please try again." };
  }
};

// ── Account Management ──────────────────────────────────────────

export const signOut = async (): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signOut();
    try {
      await GoogleSignin.signOut();
    } catch {
      /* ignore */
    }

    authActions.setSession(null);
    mmkv.set(SESSION_CACHE_KEY, false);
    mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
    queryClient.removeQueries({ queryKey: ["plan"] });
    getPosthogClient()?.reset();
    track(AnalyticsEvents.SIGN_OUT);

    if (error) return { ok: false, error: error.message };
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
    const { error } = await supabase.rpc("delete_user");
    if (error) {
      logger.error("[Auth] delete_user RPC error:", error);
      return {
        ok: false,
        error:
          "Please contact support at support@ekwe.app to complete account deletion.",
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
    queryClient.clear();
    authActions.setSession(null);
    mmkv.set(SESSION_CACHE_KEY, false);
    mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
    getPosthogClient()?.reset();
    track(AnalyticsEvents.DELETE_ACCOUNT);

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] deleteAccount error:", err);
    return {
      ok: false,
      error: "Something went wrong. Please contact support for help.",
    };
  }
};
