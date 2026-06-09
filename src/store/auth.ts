import { observable } from "@legendapp/state";
import { persistObservable } from "@legendapp/state/persist";
import { Session, User } from "@supabase/supabase-js";

import { ObservablePersistMMKV } from "@/store/mmkvPlugin";

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
  isInitialized: boolean;
  transactionsUsed: number;
  activeTier: "FREE" | "PREMIUM";
  isFallback: boolean;
}

const initialAuth: AuthState = {
  session: null,
  user: null,
  isPro: false,
  isInitialized: false,
  transactionsUsed: 0,
  activeTier: "FREE",
  isFallback: false,
};

export const auth$ = observable<AuthState>(initialAuth);

persistObservable(auth$.isPro, {
  local: "ekwe-auth-isPro",
  pluginLocal: ObservablePersistMMKV,
});
persistObservable(auth$.transactionsUsed, {
  local: "ekwe-auth-transactions",
  pluginLocal: ObservablePersistMMKV,
});
persistObservable(auth$.activeTier, {
  local: "ekwe-auth-tier",
  pluginLocal: ObservablePersistMMKV,
});
persistObservable(auth$.isFallback, {
  local: "ekwe-auth-fallback",
  pluginLocal: ObservablePersistMMKV,
});

// Actions
export const authActions = {
  setSession: (session: Session | null): void => {
    const isPro = session?.user?.app_metadata?.is_pro === true;

    // Clear stale billing states when signing out
    const billingState = session
      ? {}
      : {
          transactionsUsed: 0,
          activeTier: "FREE" as const,
          isFallback: false,
        };

    auth$.assign({
      session,
      user: session?.user || null,
      isPro,
      ...billingState,
    });
  },
  setUser: (user: User | null): void => {
    auth$.user.set(user);
  },
  setIsPro: (isPro: boolean): void => {
    auth$.isPro.set(isPro);
  },
  setInitialized: (initialized: boolean): void => {
    auth$.isInitialized.set(initialized);
  },
  updateBilling: (data: {
    transactions_used: number;
    tier_active: "FREE" | "PREMIUM";
    is_fallback: boolean;
  }): void => {
    auth$.assign({
      transactionsUsed: data.transactions_used,
      activeTier: data.tier_active,
      isFallback: data.is_fallback,
    });
  },
};
