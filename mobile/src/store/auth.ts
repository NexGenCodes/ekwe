import { observable } from "@legendapp/state";
import { persistObservable } from "@legendapp/state/persist";
import { Session, User } from "@supabase/supabase-js";

import { ObservablePersistMMKV } from "@/store/mmkvPlugin";

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
  isInitialized: boolean;
  sessionLoaded: boolean;
}

const initialAuth: AuthState = {
  session: null,
  user: null,
  isPro: false,
  isInitialized: false,
  sessionLoaded: false,
};

export const auth$ = observable<AuthState>(initialAuth);

persistObservable(auth$.isPro, {
  local: "ekwe-auth-isPro",
  pluginLocal: ObservablePersistMMKV,
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
  setSessionLoaded: (loaded: boolean): void => {
    auth$.sessionLoaded.set(loaded);
  },
};
