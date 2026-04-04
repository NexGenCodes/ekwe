import { useFonts } from 'expo-font';
import { useKeepAwake } from 'expo-keep-awake';
import * as SplashScreen from 'expo-splash-screen';
import { JSX, useEffect } from 'react';
import { RootNavigator } from 'src/navigation/RootNavigator';
import { initialiseSentry } from 'src/utils/sentry';

initialiseSentry();
SplashScreen.preventAutoHideAsync();

export default function App(): JSX.Element | null {
  useKeepAwake();
  const [fontsLoaded, fontError] = useFonts({
    'DMSerifDisplay-Regular': require('./assets/fonts/DMSerifDisplay-Regular.ttf'),
    'Outfit-Regular': require('./assets/fonts/Outfit-Regular.ttf'),
    'Outfit-Medium': require('./assets/fonts/Outfit-Medium.ttf'),
    'SpaceMono-Regular': require('./assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return <RootNavigator />;
}
