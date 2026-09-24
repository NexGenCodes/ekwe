import { Stack } from "expo-router";
import React from "react";

import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks";

export default function LegalLayout(): React.JSX.Element {
  const { color, isDark } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTransparent: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: color.background },
        headerTintColor: color.foreground,
        headerTitleStyle: {
          fontFamily: typography.heading2.fontFamily,
          fontSize: 24,
          fontWeight: "400",
          color: color.foreground,
        },
        statusBarStyle: isDark ? "light" : "dark",
        statusBarTranslucent: true,
      }}
    >
      <Stack.Screen name="[slug]" />
    </Stack>
  );
}
