import { observable } from "@legendapp/state";
import { Session, User } from "@supabase/supabase-js";
import type { PaymentProvider } from "@ekwe/shared";
import { setSentryUser } from "@/utils/logger";

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
  /** True once the payment provider has reported for the current user
   * (status reconciled). While true, isPro is owned by the entitlement and
   * session refreshes must not override it. */
  isProEntitlementSynced: boolean;
  isInitialized: boolean;
  sessionLoaded: boolean;
}

const initialAuth: AuthState = {
  session: null,
  user: null,
  isPro: false,
  isProEntitlementSynced: false,
  isInitialized: false,
  sessionLoaded: false,
};

export const auth$ = observable<AuthState>(initialAuth);

export function getToken(): string | null {
  const session = auth$.session.peek();
  return session?.access_token ?? null;
}

// Actions
export const authActions = {
  setSession: (session: Session | null): void => {
    const metadataIsPro = session?.user?.app_metadata?.is_pro === true;
    const previousUser = auth$.user.peek();
    const sameUser = !!previousUser && session?.user?.id === previousUser.id;

    // The payment provider's status reconciliation (useBilling) is the
    // real-time source of truth for isPro. app_metadata.is_pro is minted by
    // the access-token hook only after the purchase webhook lands, so a
    // session refresh during that window still reports false — never downgrade
    // a same-user session based on that stale metadata.
    //
    // Once the entitlement has synced, isPro is owned by the entitlement and
    // session refreshes must never touch it: stale metadata can otherwise
    // re-upgrade a cancelled/expired/refunded user back to Pro. Only fall back
    // to metadata before the first entitlement sync (or on a different user).
    const entitlementSynced = auth$.isProEntitlementSynced.peek();
    const isPro = session
      ? sameUser && entitlementSynced
        ? auth$.isPro.peek()
        : metadataIsPro || (sameUser && auth$.isPro.peek())
      : false;

    auth$.assign({
      session,
      user: session?.user || null,
      isPro,
      // Track sync state per user: reset when the user changes or signs out.
      isProEntitlementSynced: sameUser ? entitlementSynced : false,
    });

    // Sentry scope identity follows the session (id only — the scrub policy +
    // anonymous fallback keep PII off the event entirely).
    setSentryUser(session?.user ? { id: session.user.id } : null);
  },
  setUser: (user: User | null): void => {
    auth$.user.set(user);
  },
  setIsPro: (isPro: boolean): void => {
    auth$.isPro.set(isPro);
  },
  setEntitlementSynced: (
    synced: boolean,
    _provider?: PaymentProvider,
  ): void => {
    auth$.isProEntitlementSynced.set(synced);
  },
  /** Clears the entitlement-synced flag when the active payment provider
   * changes, so the newly active provider can take ownership of the Pro state
   * (its own reconcile/entitlement must re-report before stale session
   * metadata can be trusted again). */
  resetEntitlementForProviderSwitch: (): void => {
    auth$.isProEntitlementSynced.set(false);
  },
  setInitialized: (initialized: boolean): void => {
    auth$.isInitialized.set(initialized);
  },
  setSessionLoaded: (loaded: boolean): void => {
    auth$.sessionLoaded.set(loaded);
  },
};
