import { Redirect } from 'expo-router';

import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';

/**
 * Index Gatekeeper
 *
 * Single decision point for the entire app.
 * Reads Supabase auth state + MMKV onboarding flag and redirects accordingly.
 * While Supabase is hydrating from MMKV, returns null (splash stays visible).
 */
export default function Index(): React.ReactElement | null {
  const { isInitialized, session } = useAuthStore();
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);

  // Supabase still hydrating from MMKV — keep splash visible
  if (!isInitialized) return null;

  // Route decision tree
  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  // Force auth: go to login if no session, else tabs
  if (!session) return <Redirect href="/(auth)/login" />;

  return <Redirect href="/(tabs)" />;
}
