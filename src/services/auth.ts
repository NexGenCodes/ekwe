/**
 * Auth Service — Single source of truth for all Supabase auth operations.
 *
 * Every auth screen calls these functions instead of touching supabase.auth directly.
 * This keeps screens thin and auth logic testable + swappable.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { supabase } from '@/services/supabase';
import { authActions } from '@/store';
import logger from '@/utils/logger';

// ── Types ────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
}

// ── Initialization ─────────────────────────────────────────────────

let _authInitialized = false;

export const initAuth = (): void => {
  if (_authInitialized) return;
  _authInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    logger.info(`Auth state changed: ${event}`, session?.user?.id);
    authActions.setSession(session);
    authActions.setInitialized(true);
  });

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      logger.error('Error fetching auth session', error);
      authActions.setInitialized(true);
      return;
    }

    if (data?.session) {
      authActions.setSession(data.session);
    }

    authActions.setInitialized(true);
  });
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
          error.message === 'Invalid login credentials'
            ? 'Incorrect email or password.'
            : error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    logger.error('[Auth] signInWithPassword error:', err);
    return { ok: false, error: 'Sign in failed. Please try again.' };
  }
};

export const signUpWithPassword = async (
  email: string,
  password: string,
): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) return { ok: false, error: error.message };
    // Supabase sends a confirmation OTP email
    return { ok: true, needsOtp: true };
  } catch (err) {
    logger.error('[Auth] signUpWithPassword error:', err);
    return { ok: false, error: 'Sign up failed. Please try again.' };
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
    logger.error('[Auth] sendOtp error:', err);
    return { ok: false, error: 'Failed to send verification code.' };
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
      type: 'email',
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) return { ok: false, error: 'Verification failed.' };
    return { ok: true };
  } catch (err) {
    logger.error('[Auth] verifyOtp error:', err);
    return { ok: false, error: 'Invalid code. Please try again.' };
  }
};

// ── Password Reset ──────────────────────────────────────────────

export const sendPasswordReset = async (email: string): Promise<AuthResult> => {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'ekwe://reset-password',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    logger.error('[Auth] sendPasswordReset error:', err);
    return { ok: false, error: 'Failed to send reset link.' };
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
    logger.error('[Auth] updatePassword error:', err);
    return { ok: false, error: 'Failed to update password.' };
  }
};

// ── Social: Apple ───────────────────────────────────────────────

export const signInWithApple = async (): Promise<AuthResult> => {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: 'Apple Sign In is only available on iOS.' };
  }

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { ok: false, error: 'Apple Sign In failed — no identity token.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });

    if (error) return { ok: false, error: error.message };

    // Apple only provides name on FIRST sign-in — persist it
    if (credential.fullName?.givenName) {
      await supabase.auth.updateUser({
        data: {
          full_name:
            `${credential.fullName.givenName} ${credential.fullName.familyName || ''}`.trim(),
        },
      });
    }

    return { ok: true };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'ERR_REQUEST_CANCELED'
    ) {
      return { ok: false }; // User cancelled — not an error
    }
    logger.error('[Auth] Apple sign-in error:', err);
    return { ok: false, error: 'Apple Sign In failed.' };
  }
};

// ── Social: Google ──────────────────────────────────────────────

let googleConfigured = false;

const configureGoogleSignIn = (): void => {
  if (googleConfigured) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      GoogleSignin,
    } = require('@react-native-google-signin/google-signin');
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      scopes: ['openid', 'email', 'profile'],
    });
    googleConfigured = true;
  } catch {
    // Package not installed — will fail gracefully at signIn time
  }
};

export const signInWithGoogle = async (): Promise<AuthResult> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      GoogleSignin,
    } = require('@react-native-google-signin/google-signin');
    configureGoogleSignIn();

    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();

    const idToken = userInfo.data?.idToken;
    if (!idToken) {
      return { ok: false, error: 'Google Sign In failed — no ID token.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'SIGN_IN_CANCELLED'
    ) {
      return { ok: false }; // User cancelled — not an error
    }
    logger.error('[Auth] Google sign-in error:', err);
    return { ok: false, error: 'Google Sign In failed.' };
  }
};

// ── Deep Link Session ───────────────────────────────────────────

export const setSessionFromDeepLink = async (url: string): Promise<boolean> => {
  try {
    const fragment = url.split('#')[1] || url.split('?')[1] || '';
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (!access_token || !refresh_token) return false;

    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    return !error;
  } catch (err) {
    logger.error('[Auth] setSessionFromDeepLink error:', err);
    return false;
  }
};
