/**
 * Auth Service — Single source of truth for all Supabase auth operations.
 *
 * Every auth screen calls these functions instead of touching supabase.auth directly.
 * This keeps screens thin and auth logic testable + swappable.
 */
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";

import { queryClient } from "@/hooks/queries/queryClient";
import { posthogClient } from "@/lib/posthog";
import { supabase } from "@/services/supabase";
import { auth$, authActions } from "@/store";
import { isIOS } from "@/utils";
import { track, identify, AnalyticsEvents } from "@/utils/analytics";
import logger from "@/utils/logger";

// ── Types ────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
}

// ── Initialization ─────────────────────────────────────────────────

let _authSubscription: { unsubscribe: () => void } | null = null;

export const initAuth = (): void => {
  if (auth$.isInitialized.peek()) return;

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
    authActions.setInitialized(true);

    if (event === "SIGNED_IN" && session?.user) {
      identify(session.user.id, {
        email: session.user.email ?? "",
        is_pro: session.user.app_metadata?.is_pro === true,
      });
    }

    if (event === "SIGNED_OUT") {
      queryClient.invalidateQueries({ queryKey: ["translate"] });
      queryClient.invalidateQueries({ queryKey: ["transcribe"] });
    }
  });
  _authSubscription = subscription;
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
    if (error) return { ok: false, error: error.message };
    return { ok: true, needsOtp: true };
  } catch (err) {
    logger.error("[Auth] sendOtp error:", err);
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
    if (error) return { ok: false, error: error.message };
    if (!data.session)
      return { ok: false, error: "Verification didn't complete. Try again." };

    track(
      type === "signup" ? AnalyticsEvents.SIGN_UP : AnalyticsEvents.SIGN_IN,
      { method: "otp" },
    );

    return { ok: true };
  } catch (err) {
    logger.error("[Auth] verifyOtp error:", err);
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
    } catch {}

    authActions.setSession(null);
    posthogClient?.reset();
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
    }

    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      await GoogleSignin.signOut();
    } catch {}
    queryClient.clear();
    authActions.setSession(null);
    posthogClient?.reset();
    track(AnalyticsEvents.DELETE_ACCOUNT);

    if (error) {
      return {
        ok: false,
        error:
          "Please contact support at support@ekwe.app to complete account deletion.",
      };
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
