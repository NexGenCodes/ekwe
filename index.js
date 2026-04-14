import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import * as Sentry from '@sentry/react-native';

// NOTE: Sentry.init() is called in _layout.tsx (single source of truth).
// Do NOT duplicate it here to avoid double error reports and DSN mismatches.

// Dedicated QueryClient for the share extension — isolated from the main app's instance.
const echoQueryClient = new QueryClient();

// 1. Register the Share Extension (Echo Feature)
// This runs in a SEPARATE React Native root inside the translucent ShareActivity.
// It is completely independent from the main app's React root but shares the same process.
// Auth state is read synchronously from the AuthStore (backed by MMKV/SecureStore)
// and handles its own initialization within useEchoFlow.
AppRegistry.registerComponent('share-extension', () => (props) => {
  const EchoFeature = require('./src/components/feature/Echo').Echo;
  return (
    <Sentry.TouchEventBoundary>
      <QueryClientProvider client={echoQueryClient}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
          <EchoFeature {...props} />
        </GestureHandlerRootView>
      </QueryClientProvider>
    </Sentry.TouchEventBoundary>
  );
});

// 2. Register the Main App
// We wrap AppEntry in a component so that `require` is deferred until `main` actually renders.
// This prevents Expo Router and the main app from initializing when starting the share extension.
// NOTE: Sentry.wrap() is already applied to RootLayout in _layout.tsx — no need to double-wrap.
const MainAppWrapper = (props) => {
  const App = require('./src/app/AppEntry').default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
