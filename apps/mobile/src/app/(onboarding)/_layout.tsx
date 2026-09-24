import { Stack } from "expo-router";
import React from "react";

import { useTheme } from "@/hooks";

export default function OnboardingLayout(): React.ReactElement {
  const { isDark } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        statusBarStyle: isDark ? "light" : "dark",
        statusBarTranslucent: true,
      }}
    />
  );
}
