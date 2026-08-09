import { useSelector } from "@legendapp/state/react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { settings$ } from "@/store/settings";
import { auth$ } from "@/store/auth";

/**
 * Index Gatekeeper
 *
 * Single decision point for the entire app.
 * Reads Supabase auth state + MMKV onboarding flag and redirects accordingly.
 * The splash is hidden once the first React frame commits (layout), so until
 * auth is initialized this gatekeeper renders nothing and the themed native
 * window shows. Once initialized, shows a brief loading spinner if session is
 * still recovering.
 */
export default function Index(): React.ReactElement | null {
  const isInitialized = useSelector(() => auth$.isInitialized.get());
  const sessionLoaded = useSelector(() => auth$.sessionLoaded.get());
  const session = useSelector(() => auth$.session.get());
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  // Auth not initialized yet — session decision isn't reliable. The native
  // window background (set to the splash color) shows through until then.
  if (!isInitialized) return null;

  // Initialized but session still loading from SecureStore — show spinner
  if (!sessionLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Route decision tree
  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  // Force auth: go to login if no session, else tabs
  if (!session) return <Redirect href="/(auth)/login" />;

  return <Redirect href="/(tabs)" />;
}
