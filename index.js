import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// 1. Register the Share Extension (Echo Feature)
AppRegistry.registerComponent('share-extension', () => (props) => {
  const EchoFeature = require('./src/components/features/Echo').Echo;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'transparent' }}>
      <EchoFeature {...props} />
    </GestureHandlerRootView>
  );
});

// 2. Register the Main App
const MainAppWrapper = (props) => {
  const App = require('./src/app/AppEntry').default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
