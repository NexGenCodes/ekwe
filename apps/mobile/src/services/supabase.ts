import { createClient, SupportedStorage } from "@supabase/supabase-js";
import { AppState } from "react-native";

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
  AppState.addEventListener("change", (state: string) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
