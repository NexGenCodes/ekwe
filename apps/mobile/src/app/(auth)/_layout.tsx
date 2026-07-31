import { useSelector } from "@legendapp/state/react";
import { Redirect, Stack } from "expo-router";

import { settings$ } from "@/store";

export default function AuthLayout(): React.ReactElement {
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    />
  );
}
