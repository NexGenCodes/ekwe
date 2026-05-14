import { useSelector } from '@legendapp/state/react';
import { Redirect } from 'expo-router';

import { settings$, auth$ } from '@/store';

/**
 * Index Gatekeeper
 *
 * Single decision point for the entire app.
 * Reads Supabase auth state + MMKV onboarding flag and redirects accordingly.
 * While Supabase is hydrating from MMKV, returns null (splash stays visible).
 */
export default function Index(): React.ReactElement | null {
  const isInitialized = useSelector(() => auth$.isInitialized.get());
  const session = useSelector(() => auth$.session.get());
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  // Supabase still hydrating from MMKV — keep splash visible
  if (!isInitialized) return null;

  // Route decision tree
  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  // Force auth: go to login if no session, else tabs
  if (!session) return <Redirect href="/(auth)/login" />;

  return <Redirect href="/(tabs)" />;
}
