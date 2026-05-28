/**
 * Auth Service — Single source of truth for all Supabase auth operations.
 *
 * Every auth screen calls these functions instead of touching supabase.auth directly.
 * This keeps screens thin and auth logic testable + swappable.
 */
import { AuthService, AuthError } from "react-native-nitro-auth";

import { queryClient } from "@/hooks/queries/queryClient";
import { supabase } from "@/services/supabase";
import { authActions } from "@/store";
import { isIOS } from "@/utils";
import logger from "@/utils/logger";

// ── Types ────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
}

// ── Initialization ─────────────────────────────────────────────────

let _authInitialized = false;
let _authSubscription: { unsubscribe: () => void } | null = null;

export const initAuth = (): void => {
  if (_authInitialized) return;
  _authInitialized = true;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    logger.info(`Auth state changed: ${event}`, session?.user?.id);
    authActions.setSession(session);
    authActions.setInitialized(true);
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
  _authInitialized = false;
};

// ── Email + Password ─────────────────────────────────────────────

export const signInWithPassword = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      return {
        ok: false,
        error:
          error.message === "Invalid login credentials"
            ? "Incorrect email or password."
            : error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] signInWithPassword error:", err);
    return { ok: false, error: "Something went wrong. Give it another try." };
  }
};

export const signUpWithPassword = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) return { ok: false, error: error.message };
    // If session is present, user was auto-confirmed or already existed
    // — no OTP email was sent, so skip OTP verification.
    const needsOtp = !data.session;
    return { ok: true, needsOtp };
  } catch (err) {
    logger.error("[Auth] signUpWithPassword error:", err);
    return { ok: false, error: "Something went wrong. Want to try again?" };
  }
};

// ── OTP (Passwordless) ──────────────────────────────────────────

export const sendOtp = async (email: string): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
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
): Promise<AuthResult> => {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session)
      return { ok: false, error: "Verification didn't complete. Try again." };
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] verifyOtp error:", err);
    return { ok: false, error: "That code didn't match. Check and try again." };
  }
};

// ── Password Reset ──────────────────────────────────────────────

export const sendPasswordResetOtp = async (
  email: string,
): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false, // Prevent creating an account if email doesn't exist
      },
    });

    if (error) {
      logger.error("[Auth] sendPasswordResetOtp error:", error);
      // Pass through rate-limit errors so the user knows they are spamming
      if (error.status === 429) {
        return {
          ok: false,
          error: "Too many requests. Wait a moment and try again.",
        };
      }
      // Security: Silently succeed for all other errors (like user not found)
      // to prevent email enumeration attacks.
      return { ok: true };
    }
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] sendPasswordResetOtp error:", err);
    // Security: Silently succeed on unexpected exceptions too
    return { ok: true };
  }
};

export const updatePassword = async (
  newPassword: string,
): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] updatePassword error:", err);
    return { ok: false, error: "Couldn't update your password. Try again." };
  }
};

// ── Social: Apple ───────────────────────────────────────────────

export const signInWithApple = async (): Promise<AuthResult> => {
  if (!isIOS) {
    return { ok: false, error: "Apple Sign In is available on iOS only." };
  }

  try {
    await AuthService.login("apple", {
      scopes: ["email", "fullName"],
    });

    const user = AuthService.currentUser;
    const idToken = user?.idToken;
    if (!idToken) {
      return { ok: false, error: "Apple Sign In couldn't be completed." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: idToken,
    });

    if (error) return { ok: false, error: error.message };

    if (user?.name) {
      await supabase.auth.updateUser({
        data: { full_name: user.name },
      });
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof AuthError && err.code === "cancelled") {
      return { ok: false };
    }
    logger.error("[Auth] Apple sign-in error:", err);
    return { ok: false, error: "Apple Sign In failed. Please try again." };
  }
};

// ── Social: Google ──────────────────────────────────────────────

export const signInWithGoogle = async (): Promise<AuthResult> => {
  try {
    await AuthService.login("google", {
      scopes: ["openid", "email", "profile"],
    });

    const user = AuthService.currentUser;
    const idToken = user?.idToken;
    if (!idToken) {
      return { ok: false, error: "Google Sign In couldn't be completed." };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof AuthError && err.code === "cancelled") {
      return { ok: false };
    }
    logger.error("[Auth] Google sign-in error:", err);
    return { ok: false, error: "Google Sign In failed. Please try again." };
  }
};

// ── Deep Link Session ───────────────────────────────────────────

export const setSessionFromDeepLink = async (url: string): Promise<boolean> => {
  try {
    const fragment = url.split("#")[1] || url.split("?")[1] || "";
    const params = new URLSearchParams(fragment);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");

    if (!access_token || !refresh_token) return false;

    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    return !error;
  } catch (err) {
    logger.error("[Auth] setSessionFromDeepLink error:", err);
    return false;
  }
};

// ── Account Management ──────────────────────────────────────────

export const signOut = async (): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signOut();
    AuthService.logout();
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
    await supabase.auth.signOut();
    AuthService.logout();
    queryClient.clear();
    return { ok: true };
  } catch (err) {
    logger.error("[Auth] deleteAccount error:", err);
    return {
      ok: false,
      error: "Something went wrong. Please contact support for help.",
    };
  }
};
