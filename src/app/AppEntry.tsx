import { ExpoRoot } from 'expo-router';
import React from 'react';

/**
 * Isolated entry point for the Main Application.
 * This ensures that index.js can register the share-extension 
 * without immediately loading the full Expo Router tree and its side effects.
 */
export default function App() {
  // @ts-ignore - require.context is an Expo/Metro special feature
  const ctx = require.context('.');
  return <ExpoRoot context={ctx} />;
}
