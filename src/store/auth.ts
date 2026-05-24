import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';
import { Session, User } from '@supabase/supabase-js';

import { ObservablePersistSQLite } from '@/store/sqlitePlugin';

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
  isInitialized: boolean;
  transactionsUsed: number;
  activeTier: 'FREE' | 'PREMIUM';
  isFallback: boolean;
}

const initialAuth: AuthState = {
  session: null,
  user: null,
  isPro: false,
  isInitialized: false,
  transactionsUsed: 0,
  activeTier: 'FREE',
  isFallback: false,
};

export const auth$ = observable<AuthState>(initialAuth);

persistObservable(auth$.isPro, {
  local: 'ekwe-auth-isPro',
  pluginLocal: ObservablePersistSQLite,
});
persistObservable(auth$.transactionsUsed, {
  local: 'ekwe-auth-transactions',
  pluginLocal: ObservablePersistSQLite,
});
persistObservable(auth$.activeTier, {
  local: 'ekwe-auth-tier',
  pluginLocal: ObservablePersistSQLite,
});
persistObservable(auth$.isFallback, {
  local: 'ekwe-auth-fallback',
  pluginLocal: ObservablePersistSQLite,
});

// Actions
export const authActions = {
  setSession: (session: Session | null): void => {
    const isPro = session?.user?.app_metadata?.is_pro === true;
    auth$.assign({
      session,
      user: session?.user || null,
      isPro,
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
    tier_active: 'FREE' | 'PREMIUM';
    is_fallback: boolean;
  }): void => {
    auth$.assign({
      transactionsUsed: data.transactions_used,
      activeTier: data.tier_active,
      isFallback: data.is_fallback,
      isPro: data.tier_active === 'PREMIUM',
    });
  },
};
