import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import logger from "@/utils/logger";
import { getWorkerUrl } from "@/utils/networkUtils";
import type { RegisterPushTokenRequest } from "@ekwe/shared";

import { getToken } from "@/store/auth";

const UPDATE_CHANNEL_ID = "updates";
const UPDATE_CHANNEL_NAME = "App Updates";

/**
 * Configure how notifications appear when the app is in the foreground.
 * The system tray handles the display; the app just stays quiet.
 * APK update notifications bypass this entirely — they are handled natively
 * so the app never needs to open.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Store the push token in the Worker's database.
 * Called after a successful token registration. The Worker upserts the token
 * (dedup by token string) and tracks last_used_at for cleanup.
 */
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

    const response = await fetch(`${workerUrl}/push-tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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

/**
 * Create the Android notification channel.
 * Must be called BEFORE requesting permissions on Android 13+.
 * Without a channel, the permission prompt never appears.
 */
async function createNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(UPDATE_CHANNEL_ID, {
    name: UPDATE_CHANNEL_NAME,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF231F7C",
    // Omitting `sound` (rather than "default") avoids expo-notifications logging
    // "Custom sound 'default' not found" — its Android resolver treats "default"
    // as a literal raw resource name. Omitting it still yields the system sound.
  });
}

/**
 * Request notification permissions and register for push notifications.
 * Returns the Expo push token, or null if permission denied / not a device.
 *
 * Never throws: notification setup must never block app startup, and Firebase
 * (google-services.json) may not be configured yet in development.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      logger.warn(
        "[Notifications] Push notifications require a physical device",
      );
      return null;
    }

    // Android: create channel BEFORE requesting permissions (Android 13+ requirement)
    await createNotificationChannel();

    // Check existing permissions
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

    // Get the Expo push token
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

    // The Worker upserts using the token string as the PK. We don't need to
    // track whether this specific user was the one who registered it last,
    // we just fire and forget. The JWT token handles the auth mapping in the worker.
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

/**
 * Listen for token refresh events. FCM tokens can rotate at any time
 * (e.g. app data clear, token rotation). Without re-storing the new token,
 * subsequent notifications will be sent to the old (dead) token.
 */
Notifications.addPushTokenListener(async (token) => {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId || projectId === "YOUR_PROJECT_ID") return;
    // Pass the device push token from the event. Without it, getExpoPushTokenAsync
    // re-fetches the device token, which fires this listener again — infinite loop.
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
