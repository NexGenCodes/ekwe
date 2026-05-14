import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { supabase } from '@/services/supabase';
import { AppAlert } from '@/utils/alert';
import logger from '@/utils/logger';

interface UseLogoutReturn {
  /** Signs out immediately (no confirmation). */
  logout: () => Promise<void>;
  /** Shows a destructive confirmation dialog before signing out. */
  confirmLogout: () => void;
}

export const useLogout = (): UseLogoutReturn => {
  const router = useRouter();

  const logout = useCallback(async (): Promise<void> => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      logger.warn('[Auth] signOut error:', e);
    }
    router.replace('/');
  }, [router]);

  const confirmLogout = useCallback((): void => {
    AppAlert.confirm(
      'Log Out',
      'Are you sure you want to log out of Ekwe?',
      logout,
      {
        confirmText: 'Log Out',
        isDestructive: true,
      },
    );
  }, [logout]);

  return { logout, confirmLogout };
};
