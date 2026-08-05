import { registerRootComponent } from 'expo';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Echo } from './src/components/features/Echo';
import { queryClient } from './src/hooks/queries/queryClient';

if (typeof globalThis !== 'undefined') {
  globalThis.appStartTime = Date.now();
}

// Global unhandled promise rejection handler — logs full stack to Metro
if (typeof ErrorUtils !== 'undefined') {
  const origHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[GlobalErrorHandler] isFatal:', isFatal, 'message:', error?.message);
    console.error('[GlobalErrorHandler] stack:', error?.stack);
    if (origHandler) origHandler(error, isFatal);
  });
}

// The share-extension root is hosted by the native ShareActivity — a translucent
// ReactActivity that renders Echo OVER the source app (no main app opens, no
// deep link). audioUri/mimeType/sourceApp arrive as launch props. Provider
// wrappers mirror src/app/_layout.tsx so QueryClient/SafeArea contexts exist.
const ShareExtensionRoot = (props) => (
  <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <Echo {...props} />
        </ErrorBoundary>
      </QueryClientProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

AppRegistry.registerComponent('share-extension', () => ShareExtensionRoot);

// Main app entry. Android and iOS share paths are handled natively
// (ShareActivity / ShareViewController) and deep-link into the app's `/share`
// route, which hosts the Echo sheet.
const MainAppWrapper = (props) => {
  const App = require('./src/app/AppEntry').default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
