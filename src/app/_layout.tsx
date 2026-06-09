import { useSelector } from "@legendapp/state/react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ErrorBoundary,
  ToastContainer,
  AppAlertModal,
} from "@/components";
import { Box } from "@/components/ui";
import { useShareIntentHandler, useTheme, useTripleExclusivity } from "@/hooks";
import { queryClient } from "@/hooks/queries/queryClient";
import { useAppFonts } from "@/hooks/useFonts";
import { ShareIntentProvider } from "@/providers/ShareIntentProvider";
import { HistoryService } from "@/services/HistoryService";
import { SyncService } from "@/services/SyncService";
import { initAuth, cleanupAuth } from "@/services/auth";
import { initializeMMKV } from "@/services/mmkv";
import { auth$ } from "@/store";

SplashScreen.preventAutoHideAsync();

function InnerLayout(): React.ReactElement {
  const { isDark, color } = useTheme();

  const isInitialized = useSelector(() => auth$.isInitialized.get());

  // Real-time Exclusivity Guard & Share Intent Listener
  useTripleExclusivity();
  useShareIntentHandler();

  const theme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: color.background,
      },
    }),
    [isDark, color.background],
  );

  useEffect((): void => {
    if (isInitialized) {
      SplashScreen.hideAsync();
      HistoryService.cleanupLocalHistory();
    }
  }, [isInitialized]);

  return (
    <ThemeProvider value={theme}>
      <GestureHandlerRootView
        style={{
          flex: 1,
          backgroundColor: color.background,
        }}
      >
        <ErrorBoundary>
          <Box style={{ flex: 1 }}>
            <StatusBar style={isDark ? "light" : "dark"} />

            <Stack
              screenOptions={{
                headerShown: false,
                animation: "slide_from_bottom",
              }}
            >
              <Stack.Screen name="index" options={{ animation: "fade" }} />
              <Stack.Screen
                name="(onboarding)"
                options={{ animation: "fade" }}
              />
              <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
              <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
              <Stack.Screen
                name="accessibility-disclosure"
                options={{
                  presentation: "formSheet",
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: "Disclosure",
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen
                name="result"
                options={{
                  presentation: "transparentModal",
                  headerShown: false,
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen
                name="translate"
                options={{
                  presentation: "formSheet",
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: "Translate",
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen
                name="legal"
                options={{
                  headerShown: false,
                  animation: "slide_from_right",
                }}
              />
              <Stack.Screen
                name="billing"
                options={{
                  headerShown: true,
                  title: "Ekwe Pro",
                  headerBackTitle: "Back",
                  animation: "slide_from_right",
                }}
              />
            </Stack>
            <ToastContainer />
            <AppAlertModal />
          </Box>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}

function RootLayout(): React.ReactElement | null {
  const fontsLoaded = useAppFonts();
  const [appReady, setAppReady] = React.useState(false);

  useEffect(() => {
    const activate = async (): Promise<void> => {
      try {
        await activateKeepAwakeAsync();
      } catch {
        /* Silently fail if activity is not ready */
      }
      await initializeMMKV();
      initAuth();
      SyncService.start();
    };
    activate();

    return (): void => {
      deactivateKeepAwake().catch(() => {});
      SyncService.stop();
      cleanupAuth();
    };
  }, []);

  // Once fonts are loaded, set appReady to true
  React.useEffect(() => {
    if (fontsLoaded) {
      setAppReady(true);
    }
  }, [fontsLoaded]);

  if (!appReady) {
    // Return null to keep the native splash screen visible while loading fonts
    return null;
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ShareIntentProvider>
          <InnerLayout />
        </ShareIntentProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default RootLayout;
