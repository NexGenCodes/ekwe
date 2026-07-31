import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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

// 1. Register the Share Extension (Echo Feature)
AppRegistry.registerComponent('share-extension', () => (props) => {
  const EchoFeature = require('./src/components/features/Echo').Echo;
  const ErrorBoundary = require('./src/components/ErrorBoundary').ErrorBoundary;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ErrorBoundary>
        <EchoFeature {...props} />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
});

// 2. Register the Main App
const MainAppWrapper = (props) => {
  const App = require('./src/app/AppEntry').default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
