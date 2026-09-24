import { useValue } from "@legendapp/state/react";
import { Redirect, Stack } from "expo-router";

import { useTheme } from "@/hooks";
import { settings$ } from "@/store";

export default function AuthLayout(): React.ReactElement {
  const { isDark } = useTheme();
  const onboardingCompleted = useValue(() =>
    settings$.onboardingCompleted.get(),
  );

  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        statusBarStyle: isDark ? "light" : "dark",
        statusBarTranslucent: true,
      }}
    />
  );
}
