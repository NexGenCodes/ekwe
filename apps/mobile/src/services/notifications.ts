import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import logger from "@/utils/logger";
import { fetchWithRetry, getWorkerUrl } from "@/utils/http";
import type { RegisterPushTokenRequest } from "@ekwe/shared";

import { getToken } from "@/store/auth";

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
  try {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
      logger.warn("[Notifications] No worker URL — push token not stored");
      return;
    }

    const version = Constants.expoConfig?.version ?? "unknown";

    const body: RegisterPushTokenRequest = {
      push_token: pushToken,
      platform: Platform.OS === "ios" ? "ios" : "android",
      app_version: version,
    };

    const token = getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetchWithRetry(`${workerUrl}/devices/token`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      retryOnHttpResponse: false,
      timeout: 10_000,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn(
        "[Notifications] Failed to store push token:",
        response.status,
        text,
      );
    }
  } catch (error) {
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
