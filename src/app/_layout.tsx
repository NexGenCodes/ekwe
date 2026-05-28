import { useSelector } from "@legendapp/state/react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
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
  EkweLogo,
} from "@/components";
import { Box } from "@/components/ui";
import { palette } from "@/constants/colors";
import { useShareIntentHandler, useTheme, useTripleExclusivity } from "@/hooks";
import { queryClient } from "@/hooks/queries/queryClient";
import { useAppFonts } from "@/hooks/useFonts";
import { ShareIntentProvider } from "@/providers/ShareIntentProvider";
import { HistoryService } from "@/services/HistoryService";
import { SyncService } from "@/services/SyncService";
import { initAuth } from "@/services/auth";
import { auth$ } from "@/store";
import logger from "@/utils/logger";

SplashScreen.preventAutoHideAsync();

function InnerLayout(): React.ReactElement {
  const router = useRouter();
  const { isDark, color } = useTheme();

  const isInitialized = useSelector(() => auth$.isInitialized.get());

  // ─── Deep Link: Password Reset ──────────────────────────────
  useEffect(() => {
    const handleDeepLink = async ({ url }: { url: string }): Promise<void> => {
      if (!url.includes("reset-password")) return;

      const { setSessionFromDeepLink } = await import("@/services/auth");
      const success = await setSessionFromDeepLink(url);
      if (success) {
        router.replace("/(auth)/reset-password");
      }
    };

    Linking.getInitialURL()
      .then((url) => {
        if (url) handleDeepLink({ url });
      })
      .catch((err) => {
        logger.error("[deepLink] Failed to get initial URL", err);
      });

    const linkSub = Linking.addEventListener("url", handleDeepLink);
    return (): void => linkSub.remove();
  }, [router]);

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
                  presentation: "formSheet",
                  sheetGrabberVisible: true,
                  headerShown: true,
                  title: "Legal",
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
  const fontsLoaded = useAppFonts();
  const [appReady, setAppReady] = React.useState(false);

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
    SyncService.start();

    return (): void => {
      deactivateKeepAwake().catch(() => {});
      SyncService.stop();
    };
  }, []);

  // Once fonts are loaded, set appReady to true
  React.useEffect(() => {
    if (fontsLoaded) {
      setAppReady(true);
    }
  }, [fontsLoaded]);

  if (!appReady) {
    // Show a simple splash screen while fonts are loading
    return (
      <SafeAreaProvider>
        <Box
          style={{
            flex: 1,
            backgroundColor: palette.white,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <EkweLogo size={120} />
        </Box>
      </SafeAreaProvider>
    );
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
