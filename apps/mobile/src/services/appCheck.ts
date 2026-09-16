import {
  initializeAppCheck as rnInitializeAppCheck,
  getToken,
  ReactNativeFirebaseAppCheckProvider,
  type AppCheck,
} from "@react-native-firebase/app-check";
import logger from "@/utils/logger";

// Flag to track if we've initialized it yet, to prevent duplicate calls.
let initialized = false;
let appCheckInstance: AppCheck | undefined;

export const initializeAppCheck = (): void => {
  if (initialized) return;
  try {
    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: {
        provider: __DEV__ ? "debug" : "playIntegrity",
      },
      apple: {
        provider: __DEV__ ? "debug" : "appAttestWithDeviceCheckFallback",
      },
      web: {
        provider: "reCaptchaV3", // required by SDK shape, but we don't use web here
        siteKey: "unused",
      },
    });

    appCheckInstance = rnInitializeAppCheck(undefined, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    initialized = true;
  } catch (error) {
    logger.warn("[AppCheck] Failed to initialize:", error);
  }
};

export const getAppCheckToken = async (): Promise<string | null> => {
  try {
    if (!initialized) {
      initializeAppCheck();
    }
    // Pass `false` to avoid forcing a refresh if we have a valid cached token.
    if (!appCheckInstance) return null;
    const { token } = await getToken(appCheckInstance, false);
    return token;
  } catch (error) {
    logger.warn("[AppCheck] Failed to get token:", error);
    return null;
  }
};
