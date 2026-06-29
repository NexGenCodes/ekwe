import { createClient, SupportedStorage } from "@supabase/supabase-js";

import { supabaseStorage } from "@/services/supabaseStorage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: supabaseStorage as unknown as SupportedStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

let _appStateSetup = false;

export function setupAppStateListener(): void {
  if (_appStateSetup) return;
  _appStateSetup = true;
  // Deferred to avoid blocking startup — lazy-required to keep import side-effect free
  const { AppState } = require("react-native");
  AppState.addEventListener("change", (state: string) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
