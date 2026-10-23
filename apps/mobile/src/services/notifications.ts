import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import logger from "@/utils/logger";
import { apiJson, isApiError } from "@/services/backend";
import type { RegisterPushTokenRequest } from "@ekwe/shared";

import { auth$ } from "@/store/auth";

const UPDATE_CHANNEL_ID = "updates";
const UPDATE_CHANNEL_NAME = "App Updates";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function storePushToken(pushToken: string): Promise<void> {
  if (!auth$.session.peek()) {
    logger.info("[Notifications] No session — push token not stored");
    return;
  }

  try {
    const version = Constants.expoConfig?.version ?? "unknown";

    const body: RegisterPushTokenRequest = {
      push_token: pushToken,
      platform: Platform.OS === "ios" ? "ios" : "android",
      app_version: version,
    };

    await apiJson("/devices/token", {
      method: "POST",
      body,
      timeoutMs: 10_000,
      retries: 1,
    });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      logger.info("[Notifications] Push token not stored: signed out");
      return;
    }
    logger.warn(
      "[Notifications] Failed to store push token (non-blocking):",
      error,
    );
  }
}

async function createNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(UPDATE_CHANNEL_ID, {
    name: UPDATE_CHANNEL_NAME,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      logger.warn(
        "[Notifications] Push notifications require a physical device",
      );
      return null;
    }

    await createNotificationChannel();

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      logger.warn("[Notifications] Permission not granted");
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId || projectId === "YOUR_PROJECT_ID") {
      logger.warn(
        "[Notifications] No EAS project ID found — push token not generated",
      );
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const pushToken = tokenData.data;

    logger.info("[Notifications] Push token registered:", pushToken);

    await storePushToken(pushToken);

    return pushToken;
  } catch (error) {
    logger.warn(
      "[Notifications] Push registration failed (non-blocking) — is google-services.json configured?",
      error,
    );
    return null;
  }
}

Notifications.addPushTokenListener(async (token) => {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId || projectId === "YOUR_PROJECT_ID") return;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
      devicePushToken: token,
    });
    logger.info("[Notifications] Token refreshed:", tokenData.data);
    await storePushToken(tokenData.data);
  } catch (error) {
    logger.warn("[Notifications] Token refresh re-register failed:", error);
  }
});

import { router, type Href } from "expo-router";

export function setupNotificationTapListener(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const { notification } = response;
      const data = notification.request.content.data as { url?: string };

      logger.info("[Notifications] Notification tapped:", JSON.stringify(data));

      if (data?.url) {
        try {
          router.push(data.url as Href);
        } catch (err) {
          logger.warn(
            "[Notifications] Failed to push notification route:",
            err,
          );
        }
      }
    },
  );

  return () => subscription.remove();
}
