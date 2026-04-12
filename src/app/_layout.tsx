import '../../global.css';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ThemeSync } from '@/components';
import { EchoSheet } from '@/components/EchoSheet';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ShareIntentProvider } from '@/components/providers/ShareIntentProvider';
import { colors, getColor } from '@/constants/colors';
import { useAuth } from '@/hooks/useAuth';
import { useShareIntentHandler } from '@/hooks/useShareIntentHandler';
import { useTripleExclusivity } from '@/hooks/useTripleExclusivity';
import { ClerkProvider } from '@/providers/ClerkProvider';
import { useAudioStore, useSettingsStore } from '@/store';
import {
  configureNotifications,
  registerNotificationCategories,
} from '@/utils/IosNotification';
import { LensBubble } from '@/components/LensBubble.android';

SplashScreen.preventAutoHideAsync();

function InnerLayout() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { isSignedIn, isLoaded } = useAuth();
  const { selectedLanguages, targetLanguage } = useSettingsStore();

  // Real-time Exclusivity Guard & Share Intent Listener
  useTripleExclusivity();
  useShareIntentHandler();

  const theme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: getColor('background', isDark),
    },
  };

  const showOverlay = useAudioStore((state) => state.showOverlay);

  useEffect(() => {
    if (isLoaded) {
      SplashScreen.hideAsync();
    }
  }, [isLoaded]);

  if (!isLoaded) return null;

  return (
    <ThemeProvider value={theme}>
      <GestureHandlerRootView
        style={{
          flex: 1,
          backgroundColor: isDark
            ? colors.background.dark
            : colors.background.DEFAULT,
        }}
      >
        <ErrorBoundary>
          <View className="flex-1">
            <ThemeSync />
            <StatusBar style="auto" />

            {showOverlay ? (
              /* 
                Isolated Share Intent View 
                We skip Stack/Tabs/Bubble to prevent background resource 
                usage and ensure context exclusivity.
              */
              <View className="flex-1">
                <EchoSheet />
              </View>
            ) : (
              /* Normal App Flow */
              <>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    animation: 'fade_from_bottom',
                  }}
                >
                  {!isSignedIn ? (
                    <Stack.Screen
                      name="sign-in"
                      options={{ animation: 'fade' }}
                    />
                  ) : (
                    <>
                      <Stack.Screen
                        name="welcome"
                        options={{ animation: 'fade' }}
                      />
                      <Stack.Screen
                        name="(tabs)"
                        options={{ animation: 'fade' }}
                      />
                      <Stack.Screen
                        name="result"
                        options={{
                          presentation: 'modal',
                          animation: 'slide_from_bottom',
                        }}
                      />
                      <Stack.Screen
                        name="translate"
                        options={{
                          presentation: 'modal',
                          animation: 'slide_from_bottom',
                        }}
                      />
                      <Stack.Screen
                        name="accessibility-disclosure"
                        options={{
                          presentation: 'modal',
                          animation: 'slide_from_bottom',
                        }}
                      />
                    </>
                  )}
                </Stack>
                <LensBubble />
                <EchoSheet />
              </>
            )}
          </View>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}

export default function RootLayout() {
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
    const activate = async (): Promise<void> => {
      try {
        await activateKeepAwakeAsync();
      } catch {
        /* Silently fail if activity is not ready */
      }
    };
    activate();

    return (): void => {
      deactivateKeepAwake().catch(() => { });
    };
  }, []);

  return (
    <ClerkProvider>
      <ShareIntentProvider>
        <InnerLayout />
      </ShareIntentProvider>
    </ClerkProvider>
  );
}
