import { createClient, SupportedStorage } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { secureStorage } from '@/services/secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage as unknown as SupportedStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const appStateSubscription = AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

// Keep subscription reference to prevent garbage collection
// In typical React Native apps, this runs for app lifetime which is correct
export { appStateSubscription };
