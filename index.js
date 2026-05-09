import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Dedicated QueryClient for the share extension — isolated from the main app's instance.
const echoQueryClient = new QueryClient();

// 1. Register the Share Extension (Echo Feature)
AppRegistry.registerComponent('share-extension', () => (props) => {
  const EchoFeature = require('./src/components/feature/Echo').Echo;
  return (
    <QueryClientProvider client={echoQueryClient}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
        <EchoFeature {...props} />
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
});

// 2. Register the Main App
const MainAppWrapper = (props) => {
  const App = require('./src/app/AppEntry').default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
