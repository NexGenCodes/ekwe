import { Stack } from "expo-router";
import React from "react";

export default function LegalLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[slug]" />
    </Stack>
  );
}
