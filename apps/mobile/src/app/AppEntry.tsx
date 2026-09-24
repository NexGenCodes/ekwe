import { ExpoRoot } from "expo-router";
import React from "react";

export default function App(): React.ReactElement {
  // @ts-expect-error - require.context is an Expo/Metro special feature
  const ctx = require.context(".");
  return <ExpoRoot context={ctx} />;
}
