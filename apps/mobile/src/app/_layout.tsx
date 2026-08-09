import { useSelector } from "@legendapp/state/react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { setBackgroundColorAsync } from "expo-system-ui";
import React, { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Direct imports (NOT the @/components / @/hooks barrels): the barrels
// transitively statically import Skia, WebView, the Supabase client, PostHog,
// and the whole Echo/audio pipeline — every one of those must parse + execute
// before the layout can render its first frame, which is exactly what turns a
// cold start into a long black screen. Importing only what the layout itself
// uses keeps the heavy graph off the boot path (route screens are already
// lazy-loaded by expo-router).
import { AppAlertModal } from "@/components/AppAlertModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/ToastContainer";
import { Box } from "@/components/ui";
import { useTheme } from "@/hooks/ui/useTheme";
import { queryClient } from "@/hooks/queries/queryClient";
import { auth$ } from "@/store/auth";
import logger from "@/utils/logger";

SplashScreen.preventAutoHideAsync();

// Startup instrumentation: measure the split between JS bundle eval and the
// first committed React frame, so a slow cold start can be attributed to module
// evaluation vs. app-level init. appStartTime is set at the very top of
// index.js; auth.ts logs the final "Startup -> Auth Init complete" marker.
function markPerformance(step: string): void {
  const globalObj = globalThis as Record<string, unknown>;
  if (typeof globalObj.appStartTime === "number") {
    logger.info(
      `[Performance] ${step}: ${Date.now() - globalObj.appStartTime}ms`,
    );
  }
}

markPerformance("Module graph evaluated (layout imported)");

function InnerLayout(): React.ReactElement {
  const { isDark, color } = useTheme();

  const isInitialized = useSelector(() => auth$.isInitialized.get());
  const sessionLoaded = useSelector(() => auth$.sessionLoaded.get());

  // First committed React frame — the splash can hide here (the router and
  // theme are mounted), so the user sees the themed window, not a void. The
  // gatekeeper (index.tsx) still waits for auth before deciding where to go.
  useEffect(() => {
    markPerformance("First React frame committed");
    SplashScreen.hideAsync();
  }, []);

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
      if (sessionLoaded) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { HistoryService } = require("@/services/HistoryService");
        HistoryService.cleanupLocalHistory();
        // Import any transcription/translation the native iOS share extension
        // completed while the app was backgrounded (writes into the shared
        // App Group container and is drained here).
        HistoryService.importSharedEchoHistory(auth$.session.peek()).catch(
          (err: unknown) =>
            logger.error("[RootLayout] importSharedEchoHistory failed", err),
        );
      }
    }
  }, [isInitialized, sessionLoaded]);

  // Keep the native window / root-view background in sync with the active
  // theme so a device appearance change is reflected instantly across the
  // whole surface (Android window + behind transparent modals/sheets).
  useEffect(() => {
    setBackgroundColorAsync(color.background).catch(() => {});
  }, [color.background]);

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
                contentStyle: { backgroundColor: color.background },
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
                name="result"
                options={{
                  presentation: "transparentModal",
                  headerShown: false,
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen
                name="share"
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

function RootLayout(): React.ReactElement {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initAuth, cleanupAuth } = require("@/services/auth");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initializeMMKV } = require("@/services/mmkv");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SyncService } = require("@/services/SyncService");

    // Must resolve BEFORE initAuth: until initializeMMKV finishes, the mmkv
    // proxy falls back to the plaintext boot storage, so a concurrent initAuth
    // would persist session tokens unencrypted.
    initializeMMKV()
      .then(() => initAuth())
      .catch((err: unknown) => {
        logger.error("[RootLayout] initializeMMKV failed", err);
      })
      .finally(() => SyncService.start());

    return (): void => {
      SyncService.stop();
      cleanupAuth();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <InnerLayout />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export default RootLayout;
