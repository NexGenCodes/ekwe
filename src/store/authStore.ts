import { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mmkvStorage } from '@/store/mmkvStorage';

interface AuthState {
  session: Session | null;
  user: User | null;
  isPro: boolean;
  isInitialized: boolean;
  transactionsUsed: number;
  activeTier: 'FREE' | 'PREMIUM';
  isFallback: boolean;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setIsPro: (isPro: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  updateBilling: (data: {
    transactions_used: number;
    tier_active: 'FREE' | 'PREMIUM';
    is_fallback: boolean;
  }) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      user: null,
      isPro: false,
      isInitialized: false,
      transactionsUsed: 0,
      activeTier: 'FREE',
      isFallback: false,
      setSession: (session: Session | null): void => {
        const isPro = session?.user?.app_metadata?.is_pro === true;
        set({ session, user: session?.user || null, isPro });
      },
      setUser: (user: User | null): void => {
        set({ user });
      },
      setIsPro: (isPro: boolean): void => {
        set({ isPro });
      },
      setInitialized: (isInitialized: boolean): void => {
        set({ isInitialized });
      },
      updateBilling: (data: {
        transactions_used: number;
        tier_active: 'FREE' | 'PREMIUM';
        is_fallback: boolean;
      }): void => {
        set({
          transactionsUsed: data.transactions_used,
          activeTier: data.tier_active,
          isFallback: data.is_fallback,
        });
      },
    }),
    {
      name: 'ekwe-auth-billing',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state: AuthState): Partial<AuthState> => ({
        transactionsUsed: state.transactionsUsed,
        activeTier: state.activeTier,
        isFallback: state.isFallback,
      }),
    },
  ),
);

