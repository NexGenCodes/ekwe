import { useSelector } from '@legendapp/state/react';
import NetInfo from '@react-native-community/netinfo';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components';
import { colors } from '@/constants/colors';
import { useShareIntentHandler, useTheme, useTripleExclusivity } from '@/hooks';
import { ShareIntentProvider } from '@/providers/ShareIntentProvider';
import { HistoryService } from '@/services/HistoryService';
import { initAuth } from '@/services/auth';
import { auth$ } from '@/store';
import {
  configureNotifications,
  registerNotificationCategories,
} from '@/utils/IosNotification';

SplashScreen.preventAutoHideAsync();

function InnerLayout(): React.ReactElement {
  const router = useRouter();
  const { isDark, color } = useTheme();

  const isInitialized = useSelector(() => auth$.isInitialized.get());

  // ─── Deep Link: Password Reset ──────────────────────────────
  // When user clicks reset link in email → ekwe://reset-password?tokens...
  // We intercept, set the Supabase session, and navigate to reset screen.
  useEffect(() => {
    const handleDeepLink = async ({ url }: { url: string }): Promise<void> => {
      if (!url.includes('reset-password')) return;

      const { setSessionFromDeepLink } = await import('@/services/auth');
      const success = await setSessionFromDeepLink(url);
      if (success) {
        router.replace('/(auth)/reset-password');
      }
    };

    // Handle link that opened the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    // Handle link while app is running (warm)
    const linkSub = Linking.addEventListener('url', handleDeepLink);
    return (): void => linkSub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time Exclusivity Guard & Share Intent Listener
  useTripleExclusivity();
  useShareIntentHandler();

  const theme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: color.background,
    },
  };

  useEffect((): void => {
    if (isInitialized) {
      SplashScreen.hideAsync();
    }
  }, [isInitialized]);

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
          <View style={{ flex: 1 }}>
            <StatusBar style={isDark ? 'light' : 'dark'} />

            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_bottom',
              }}
            >
              <Stack.Screen name="index" options={{ animation: 'fade' }} />
              <Stack.Screen
                name="(onboarding)"
                options={{ animation: 'fade' }}
              />
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              <Stack.Screen
                name="accessibility-disclosure"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: 'Disclosure',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="result"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: 'Translation',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="translate"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: 'Translate',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="legal"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: 'Legal',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="billing"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: 'Ekwe Pro',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
            </Stack>
          </View>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}

function RootLayout(): React.ReactElement {
  useEffect((): void => {
    if (process.env.EXPO_OS === 'ios') {
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
    initAuth();
    HistoryService.cleanupLocalHistory();

    // Drain the sync queue on connectivity restore
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        HistoryService.drainSyncQueue();
      }
    });

    return (): void => {
      deactivateKeepAwake().catch(() => {});
      netSub();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ShareIntentProvider>
        <InnerLayout />
      </ShareIntentProvider>
    </SafeAreaProvider>
  );
}

export default RootLayout;
