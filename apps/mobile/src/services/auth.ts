/**
 * Auth Service — Single source of truth for all Supabase auth operations.
 *
 * Every auth screen calls these functions instead of touching supabase.auth directly.
 * This keeps screens thin and auth logic testable + swappable.
 */
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { AuthApiError } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import { queryClient } from "@/hooks/queries/queryClient";
import { getPosthogClient } from "@/services/posthog";
import { SyncService } from "@/services/SyncService";
import { Db } from "@/services/db";
import { mmkv } from "@/services/mmkv";
import { mirrorSessionToSharedContainer } from "@/services/sharedContainer";
import { supabase, setupAppStateListener } from "@/services/supabase";
import {
  auth$,
  authActions,
  buildSettingsSharedPrefs,
  isDefinitelyOffline,
} from "@/store";
import { isIOS } from "@/utils";
import { track, identify, AnalyticsEvents } from "@/utils/analytics";
import logger from "@/utils/logger";
import { getWorkerUrl } from "@/utils/networkUtils";

const SESSION_CACHE_KEY = "hasSession";
const OTP_REQUEST_TIMEOUT_MS = 15_000;
const OFFLINE_MESSAGE = "No internet connection. Please connect and try again.";

// ── Types ────────────────────────────────────────────────────────

export interface AuthResult {
  ok: boolean;
  error?: string;
  needsOtp?: boolean;
  /** Sign-in hit an existing account under a different provider — the user
   * must verify their email (OTP) so the new identity can be linked. */
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

// Identity tokens are short-lived (5-10 min) — keep them in memory only,
// never persisted, and clear them after a successful link.
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

    if (
      (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
      session?.user
    ) {
      // Cold start with a persisted session emits INITIAL_SESSION (not
      // SIGNED_IN); without handling it, cloud history is never pulled until
      // a fresh sign-in. Both paths are idempotent (cursor-based pull).
      if (event === "SIGNED_IN") {
        identify(session.user.id, {
          email: session.user.email ?? "",
          is_pro: session.user.app_metadata?.is_pro === true,
        });

        // Push token re-registration: link the existing push token to this user
        // in the Worker now that we have an active session (and JWT).
        import("./notifications").then(({ registerForPushNotifications }) => {
          registerForPushNotifications().catch((err) =>
            logger.error("Failed to sync push token post-login:", err),
          );
        });
      }
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
      SyncService.loadInitialHistory();
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

/**
 * Send a one-time code to the given email.
 *
 * Requests are routed through the Worker which throttles per IP + email
 * before dispatching the code. Without worker URL (local dev), it falls
 * back to calling Supabase directly.
 */
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
          body: JSON.stringify({ email: email.trim() }),
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
      logger.error("[Auth] sendOtp (worker) error:", err);
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

    if (error) {
      // Apple only returns the email on the first authorization, so if it's
      // missing we can't run the link flow — surface the raw error instead.
      const email = credential.email ?? undefined;
      if (isIdentityLinkError(error) && email) {
        pendingLink = { provider: "apple", idToken };
        track(AnalyticsEvents.AUTH_NEEDS_LINK, { method: "apple" });
        return { ok: false, needsLink: { provider: "apple", email } };
      }
      return { ok: false, error: error.message };
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
      return { ok: false, error: error.message };
    }

    track(AnalyticsEvents.SIGN_IN, { method: "google" });

    return { ok: true };
  } catch (err: unknown) {
    logger.error("[Auth] Google sign-in error:", err);
    return { ok: false, error: "Google Sign In failed. Please try again." };
  }
};

// ── Account Management ──────────────────────────────────────────

/**
 * Link the pending social identity (Apple/Google) to the currently signed-in
 * user. Called after email-OTP verification in the "link" flow: the user
 * first proved ownership of the email, and is now signed in as the existing
 * account, so we can attach the new identity.
 *
 * Requires "multiple identities" to be enabled for the Supabase project.
 */
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
      return { ok: false, error: error.message };
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

    // Best-effort: push every unsynced row to the cloud BEFORE leaving, so a
    // re-login (same or new device) restores it. Only when the outbox is fully
    // drained do we purge local data and clear the pull cursor; if we're
    // offline or a row can't be pushed we KEEP local data so nothing is lost.
    if (userId) {
      await SyncService.drain();
      const remaining = Db.getPendingOutbox(userId).length;
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
    queryClient.clear();
    authActions.setSession(null);
    mmkv.set(SESSION_CACHE_KEY, false);
    mirrorSessionToSharedContainer(null, buildSettingsSharedPrefs());
    getPosthogClient()?.reset();
    track(AnalyticsEvents.DELETE_ACCOUNT);

    // The cloud rows are gone via delete_user cascade — purge the local
    // device cache so nothing of the account survives on this device.
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
