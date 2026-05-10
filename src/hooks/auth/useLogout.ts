import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { supabase } from '@/services/supabase';
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      logger.warn('[Auth] signOut error:', e);
    }
    router.replace('/');
  }, [router]);

  const confirmLogout = useCallback((): void => {
    Alert.alert('Log Out', 'Are you sure you want to log out of Ekwe?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: logout,
      },
    ]);
  }, [logout]);

  return { logout, confirmLogout };
};
