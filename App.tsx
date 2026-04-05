import './global.css';
import { useFonts } from 'expo-font';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { JSX, useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BubbleOverlay } from 'src/components/bubble/BubbleOverlay';
import { RootNavigator } from 'src/navigation/RootNavigator';
import {
  configureNotifications,
  registerNotificationCategories,
} from 'src/utils/IosNotification';
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

  // Configure notifications on iOS
  useEffect(() => {
    if (Platform.OS === 'ios') {
      const setupNotifications = async (): Promise<void> => {
        configureNotifications();
        await registerNotificationCategories();
      };
      setupNotifications();
    }
  }, []);

  useEffect(() => {
    // Manually activate keep-awake and catch rejections (common on Android startup)
    const activate = async (): Promise<void> => {
      try {
        await activateKeepAwakeAsync();
      } catch {
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1">
        <StatusBar style="auto" />
        <RootNavigator />
        <BubbleOverlay />
      </View>
    </GestureHandlerRootView>
  );
}
