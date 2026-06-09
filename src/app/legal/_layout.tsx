import { Stack } from "expo-router";
import React from "react";
import { useTheme } from "@/hooks";
import { typography } from "@/constants/typography";

export default function LegalLayout(): React.JSX.Element {
  const { color } = useTheme();
  
  return (
    <Stack 
      screenOptions={{ 
        headerShown: true,
        headerTransparent: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: color.background },
        headerTintColor: color.primary,
        headerTitleStyle: {
          fontFamily: typography.heading2.fontFamily,
          fontSize: 24,
          fontWeight: "400",
          letterSpacing: -0.5,
          color: color.foreground,
        },
      }}
    >
      <Stack.Screen name="[slug]" />
    </Stack>
  );
}
