import '../../global.css';

import NetInfo from '@react-native-community/netinfo';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ShareIntentProvider } from '@/components/providers/ShareIntentProvider';
import { colors, getColor } from '@/constants/colors';
import { useShareIntentHandler } from '@/hooks/useShareIntentHandler';
import { useTheme } from '@/hooks/useTheme';
import { useTripleExclusivity } from '@/hooks/useTripleExclusivity';
import { useSettingsStore } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { useSyncQueue } from '@/store/syncQueue';
import {
  configureNotifications,
  registerNotificationCategories,
} from '@/utils/IosNotification';

// Initialize React Query Client
const queryClient = new QueryClient();

// Configure React Query to pause/resume mutations automatically when offline/online
onlineManager.setEventListener((setOnline): (() => void) => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const isConnected = !!state.isConnected;
    setOnline(isConnected);
    if (isConnected) {
      useSyncQueue.getState().flushQueue();
    }
  });
  return (): void => unsubscribe();
});

SplashScreen.preventAutoHideAsync();

function InnerLayout(): React.ReactElement {
  const { setColorScheme, isDark } = useTheme();
  const themePreference = useSettingsStore((s) => s.themePreference);

  // Directly pass user preference to NativeWind v4 which handles OS listeners internally
  useEffect((): void => {
    setColorScheme(themePreference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePreference]);

  const { isInitialized } = useAuthStore();

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
            <StatusBar style="auto" />

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
            </Stack>
          </View>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}

function RootLayout(): React.ReactElement {
  useEffect((): void => {
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
      deactivateKeepAwake().catch(() => {});
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ShareIntentProvider>
        <InnerLayout />
      </ShareIntentProvider>
    </QueryClientProvider>
  );
}

export default RootLayout;
