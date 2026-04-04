import './global.css';
import { useFonts } from 'expo-font';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as SplashScreen from 'expo-splash-screen';
import { JSX, useEffect } from 'react';
import { RootNavigator } from 'src/navigation/RootNavigator';
import { initialiseSentry } from 'src/utils/sentry';

initialiseSentry();
SplashScreen.preventAutoHideAsync();

export default function App(): JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    'DMSerifDisplay-Regular': require('./assets/fonts/DMSerifDisplay-Regular.ttf'),
    'Outfit-Regular': require('./assets/fonts/Outfit-Regular.ttf'),
    'Outfit-Medium': require('./assets/fonts/Outfit-Medium.ttf'),
    'SpaceMono-Regular': require('./assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    // Manually activate keep-awake and catch rejections (common on Android startup)
    const activate = async (): Promise<void> => {
      try {
        await activateKeepAwakeAsync();
      } catch (_err) {
        /* Silently fail if activity is not ready */
      }
    };

    activate();

    return (): void => {
      // Correctly catch promise rejections for deactivate
      deactivateKeepAwake().catch(() => {
        /* Ignore if activity is already gone */
      });
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return <RootNavigator />;
}
