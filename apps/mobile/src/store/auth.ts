import { observable } from "@legendapp/state";
import type { Tier } from "@ekwe/shared";

import { registerIsProProvider, resetPersonalSettings } from "@/store/settings";
import { setSentryUser } from "@/utils/logger";

export interface AuthUser {
  id: string;
  email: string;
  tier: Tier;
  displayName: string | null;
  avatarUrl: string | null;
  avatarIcon: string | null;
  proExpiresAt: number | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

interface AuthState {
  session: AuthSession | null;
  user: AuthUser | null;
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

registerIsProProvider(() => auth$.isPro.peek());

export function getToken(): string | null {
  return auth$.session.peek()?.accessToken ?? null;
}

export const authActions = {
  setSession: (session: AuthSession | null): void => {
    const previousUser = auth$.user.peek();
    const sameUser = !!previousUser && session?.user.id === previousUser.id;

    auth$.assign({
      session,
      user: session?.user ?? null,
      // The worker mints the tier into the session, so the session is the
      // single source of truth for the paid plan.
      isPro: session?.user.tier === "PREMIUM",
    });

    setSentryUser(session ? { id: session.user.id } : null);

    if (previousUser && !sameUser) resetPersonalSettings();
  },
  setUser: (user: AuthUser | null): void => {
    const session = auth$.session.peek();
    if (user && session && session.user.id !== user.id) return;
    if (session && user) {
      auth$.session.set({ ...session, user });
    }
    auth$.assign({ user, isPro: user?.tier === "PREMIUM" });
  },
  setInitialized: (initialized: boolean): void => {
    auth$.isInitialized.set(initialized);
  },
  setSessionLoaded: (loaded: boolean): void => {
    auth$.sessionLoaded.set(loaded);
  },
};
