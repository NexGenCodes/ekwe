import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';

// 1. Register the Share Extension (Echo Feature)
// This runs in a SEPARATE React Native root inside the translucent ShareActivity.
// It is completely independent from the main app.
AppRegistry.registerComponent('share-extension', () => (props) => {
  const EchoFeature = require('./src/components/EchoFeature').default;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <EchoFeature {...props} />
    </GestureHandlerRootView>
  );
});

// 2. Register the Main App
// We defer the require of AppEntry to ensure side effects are contained
const registerMain = () => {
  const App = require('./src/app/AppEntry').default;
  registerRootComponent(App);
};

// Start main application
registerMain();
