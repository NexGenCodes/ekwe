import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import logger from "@/utils/logger";
import { getWorkerUrl } from "@/utils/networkUtils";

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

    const response = await fetch(`${workerUrl}/push-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        push_token: pushToken,
        platform: Platform.OS,
        app_version: version,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn("[Notifications] Failed to store push token:", response.status, text);
    }
  } catch (error) {
    logger.warn("[Notifications] Failed to store push token (non-blocking):", error);
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
    sound: "default",
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
      logger.warn("[Notifications] Push notifications require a physical device");
      return null;
    }

    // Android: create channel BEFORE requesting permissions (Android 13+ requirement)
    await createNotificationChannel();

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
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
      logger.warn("[Notifications] No EAS project ID found — push token not generated");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData.data;

    logger.info("[Notifications] Push token registered:", pushToken);

    // Store push token in the Worker's database so it can send update notifications
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
