import { useValue } from "@legendapp/state/react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";

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

import { AppAlertModal } from "@/components/AppAlertModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/ToastContainer";
import { Box } from "@/components/ui";
import { useTheme } from "@/hooks/ui/useTheme";

import { auth$ } from "@/store/auth";
import logger, { setSentryTag } from "@/utils/logger";
import type { UpdateManifest, UpdateChannel } from "@/services/otaUpdates";
import {
  initNetworkMonitoring,
  stopNetworkMonitoring,
} from "@/services/networkMonitor";

SplashScreen.preventAutoHideAsync();

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

  const isInitialized = useValue(() => auth$.isInitialized.get());
  const sessionLoaded = useValue(() => auth$.sessionLoaded.get());
  const isAuthenticated = useValue(() => auth$.session.get() !== null);

  const segments = useSegments();
  useEffect(() => {
    setSentryTag("screen", segments.join("/") || "/");
  }, [segments]);

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
        const { HistoryService } = require("@/services/historyService");
        HistoryService.importSharedEchoHistory(auth$.session.peek()).catch(
          (err: unknown) =>
            logger.error("[RootLayout] importSharedEchoHistory failed", err),
        );
      }
    }
  }, [isInitialized, sessionLoaded]);

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
                  statusBarStyle: isDark ? "light" : "dark",
                  statusBarTranslucent: true,
                }}
              >
                <Stack.Screen name="index" options={{ animation: "fade" }} />
                <Stack.Screen
                  name="(onboarding)"
                  options={{ animation: "fade" }}
                />
                <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
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
    const { SyncService } = require("@/services/syncService");
    const {
      silentUpdateCheck,
      checkForApkUpdate,
      resolveUpdateChannel,
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

    initNetworkMonitoring();

    setTimeout((): void => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sweepStaleEchoCache } = require("@/utils/audioCache");
      void sweepStaleEchoCache();
    }, 4000);

    silentUpdateCheck().catch((error: unknown): void => {
      logger.warn("[OTA] Non-blocking silent update check failed:", error);
    });

    void resolveUpdateChannel().then((channel: UpdateChannel): void => {
      update$.channel.set(channel);
    });

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

    const removeNotificationListener = setupNotificationTapListener();

    registerForPushNotifications();

    initializeMMKV()
      .then(() => initAuth())
      .then(() => {
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
      <InnerLayout />
    </SafeAreaProvider>
  );
}

export default RootLayout;
