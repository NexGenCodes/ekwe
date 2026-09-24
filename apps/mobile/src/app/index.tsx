import { useValue } from "@legendapp/state/react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { settings$ } from "@/store/settings";
import { auth$ } from "@/store/auth";

export default function Index(): React.ReactElement | null {
  const isInitialized = useValue(() => auth$.isInitialized.get());
  const sessionLoaded = useValue(() => auth$.sessionLoaded.get());
  const session = useValue(() => auth$.session.get());
  const onboardingCompleted = useValue(() =>
    settings$.onboardingCompleted.get(),
  );

  if (!isInitialized) return null;

  if (!sessionLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  if (!session) return <Redirect href="/(auth)/login" />;

  return <Redirect href="/(tabs)" />;
}
