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
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { colorScheme } from 'nativewind';
import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useSelector } from '@legendapp/state/react';

import { ErrorBoundary } from '@/components';
import { colors } from '@/constants/colors';
import { useShareIntentHandler, useTheme, useTripleExclusivity } from '@/hooks';
import { ShareIntentProvider } from '@/providers/ShareIntentProvider';
import { initAuth } from '@/services/auth';
import { settings$, auth$, syncQueueActions } from '@/store';
import { mmkv } from '@/store/mmkvStorage';
import {
  configureNotifications,
  registerNotificationCategories,
} from '@/utils/IosNotification';

// ─── Sync Theme Bootstrap ────────────────────────────────────────
// Read the persisted settings from MMKV synchronously at module scope.
// This runs BEFORE React mounts, ensuring NativeWind starts with the
// correct color scheme from frame 0 — no flash-of-wrong-theme.
// Legend-State rehydrates and takes over for reactivity.
// Key must match the persist config in store.
const _raw = mmkv.getString('ekwe-settings');
if (_raw) {
  try {
    const _pref = (JSON.parse(_raw) as { state?: { themePreference?: string } })
      ?.state?.themePreference;
    if (_pref === 'light' || _pref === 'dark' || _pref === 'system') {
      colorScheme.set(_pref);
    }
  } catch {
    // Corrupted data — fall through to system default
  }
}
// ─────────────────────────────────────────────────────────────────

// Initialize React Query Client
const queryClient = new QueryClient();

// Configure React Query to pause/resume mutations automatically when offline/online
onlineManager.setEventListener((setOnline): (() => void) => {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const isConnected = !!state.isConnected;
    setOnline(isConnected);
    if (isConnected) {
      syncQueueActions.flushQueue();
    }
  });
  return (): void => unsubscribe();
});

SplashScreen.preventAutoHideAsync();

function InnerLayout(): React.ReactElement {
  const router = useRouter();
  const { setColorScheme, isDark, color } = useTheme();
  const themePreference = useSelector(() => settings$.themePreference.get());

  // Sync user preference to NativeWind v4.
  // Also re-apply when the app resumes from background, because NativeWind
  // can silently revert to the system default while backgrounded.
  useEffect(() => {
    setColorScheme(themePreference);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setColorScheme(themePreference);
      }
    });

    return (): void => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePreference]);

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
    initAuth();

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
