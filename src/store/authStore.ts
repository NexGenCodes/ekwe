import { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean; // RevenueCat status
  isInitialized: boolean; // Initial auth load check
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setIsPro: (isPro: boolean) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  isPro: false,
  isInitialized: false,
  setSession: (session: Session | null): void =>
    set({ session, user: session?.user || null }),
  setUser: (user: User | null): void => set({ user }),
  setIsPro: (isPro: boolean): void => set({ isPro }),
  setInitialized: (isInitialized: boolean): void => set({ isInitialized }),
}));

// Set up the listener for global session state
supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.getState().setSession(session);
  useAuthStore.getState().setInitialized(true);
});

// Immediately fetch the initial session to avoid "unauthorized" flashes on mount
supabase.auth.getSession().then(({ data: { session } }) => {
  useAuthStore.getState().setSession(session);
  useAuthStore.getState().setInitialized(true);
});
