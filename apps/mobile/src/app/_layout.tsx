import { useSelector } from "@legendapp/state/react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router/stack";
import { useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { setBackgroundColorAsync } from "expo-system-ui";
import React, { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
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
import logger, { setSentryTag } from "@/utils/logger";
import type { UpdateManifest } from "@/services/otaUpdates";
import {
  initNetworkMonitoring,
  stopNetworkMonitoring,
} from "@/services/networkMonitor";

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
  const isAuthenticated = useSelector(() => auth$.session.get() !== null);

  // Tag every Sentry event with the active screen so errors from shared
  // services (transcription, sync, billing) can be blamed to a route.
  const segments = useSegments();
  useEffect(() => {
    setSentryTag("screen", segments.join("/") || "/");
  }, [segments]);

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
        // Import any transcription/translation the native iOS share extension
        // completed while the app was backgrounded (writes into the shared
        // App Group container and is drained here). Expired local rows are
        // pruned on every SyncService.start, so no separate cleanup is needed.
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
          <KeyboardProvider>
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
                {/* Auth-gated routes: hard-excluded from the navigator when
                    signed out, so deep links / back-stack cannot reach tabs,
                    history holders, or Pro purchase flows. */}
                <Stack.Protected guard={isAuthenticated}>
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
                    name="billing"
                    options={{
                      headerShown: true,
                      title: "Ekwe Pro",
                      headerBackTitle: "Back",
                      animation: "slide_from_right",
                    }}
                  />
                  <Stack.Screen name="edit-languages" />
                </Stack.Protected>
                <Stack.Screen
                  name="legal"
                  options={{
                    headerShown: false,
                    animation: "slide_from_right",
                  }}
                />
              </Stack>
              <ToastContainer />
              <AppAlertModal />
            </Box>
          </KeyboardProvider>
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
    const {
      silentUpdateCheck,
      checkForApkUpdate,
    } = require("@/services/otaUpdates"); // eslint-disable-line @typescript-eslint/no-require-imports
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { update$ } = require("@/store/update");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppAlert } = require("@/utils/alert");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require("react-native");
    const {
      registerForPushNotifications,
      setupNotificationTapListener,
    } = require("@/services/notifications"); // eslint-disable-line @typescript-eslint/no-require-imports

    // Seed the network store + TanStack onlineManager as early as possible so
    // "am I offline?" is answered the same way everywhere from the first frame.
    initNetworkMonitoring();

    // Silent OTA update — downloads in background, applies on next cold start.
    // Never blocks the app, never shows a modal, never shows a prompt.
    silentUpdateCheck();

    // Startup APK version probe (Android): feeds the Profile-tab update badge
    // and a one-shot prompt. Non-blocking — critical releases are additionally
    // pushed natively by the deploy workflow.
    checkForApkUpdate().then((manifest: UpdateManifest | null): void => {
      if (!manifest) return;
      update$.manifest.set(manifest);
      setTimeout(() => {
        AppAlert.info(
          "Update available",
          `Version ${manifest.latest_version} is ready to install.`,
          [
            { text: "Later", style: "cancel" },
            {
              text: "Download",
              onPress: (): void => {
                void Linking.openURL(manifest.download_url);
              },
            },
          ],
        );
      }, 500);
    });

    // Handle user interacting with a push notification from the tray.
    const removeNotificationListener = setupNotificationTapListener();

    // Register for push notifications — used for APK update alerts.
    // APK updates themselves are handled natively, so the app never opens.
    // Pass no userId yet — will re-register after auth resolves below.
    registerForPushNotifications();

    // Must resolve BEFORE initAuth: until initializeMMKV finishes, the mmkv
    // proxy falls back to the plaintext boot storage, so a concurrent initAuth
    // would persist session tokens unencrypted.
    initializeMMKV()
      .then(() => initAuth())
      .then(() => {
        // Re-register push token now that auth is resolved.
        // The Worker reads the user from the JWT; no need to pass user_id.
        const session = auth$.session.peek();
        if (session?.user?.id) {
          registerForPushNotifications();
        }
      })
      .catch((err: unknown) => {
        logger.error("[RootLayout] initializeMMKV failed", err);
      })
      .finally(() => SyncService.start());

    return (): void => {
      SyncService.stop();
      stopNetworkMonitoring();
      cleanupAuth();
      removeNotificationListener();
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
