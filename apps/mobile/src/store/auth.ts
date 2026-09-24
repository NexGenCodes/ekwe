import { observable } from "@legendapp/state";
import { Session, User } from "@supabase/supabase-js";
import type { PaymentProvider } from "@ekwe/shared";
import { resetPersonalSettings, registerIsProProvider } from "@/store/settings";
import { setSentryUser } from "@/utils/logger";

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
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

registerIsProProvider(() => auth$.isPro.peek());

export function getToken(): string | null {
  const session = auth$.session.peek();
  return session?.access_token ?? null;
}

export const authActions = {
  setSession: (session: Session | null): void => {
    const metadataIsPro = session?.user?.app_metadata?.is_pro === true;
    const previousUser = auth$.user.peek();
    const sameUser = !!previousUser && session?.user?.id === previousUser.id;

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
      isProEntitlementSynced: sameUser ? entitlementSynced : false,
    });

    setSentryUser(session?.user ? { id: session.user.id } : null);

    if (previousUser && !sameUser) {
      resetPersonalSettings();
    }
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
