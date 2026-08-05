import { ExpoRoot } from "expo-router";
import React from "react";

/**
 * Isolated entry point for the Main Application.
 * index.js registers this as the root component; the Android/iOS share flows
 * are handled natively and deep-link into the `/share` route.
 */
export default function App(): React.ReactElement {
  // @ts-expect-error - require.context is an Expo/Metro special feature
  const ctx = require.context(".");
  return <ExpoRoot context={ctx} />;
}
