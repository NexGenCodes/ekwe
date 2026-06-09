import { Stack } from "expo-router";
import React from "react";

export default function AuthLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
      /* Screen reader announces route changes automatically via expo-router */
    />
  );
}
