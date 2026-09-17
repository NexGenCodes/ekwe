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
    // Play Integrity / App Attest only pass for apps installed through a real
    // store (Play / App Store). For sideloaded APKs and local dev — e.g. no
    // paid Play developer account yet — pin a debug token from .env so App
    // Check keeps working in production builds too. If no token is set, dev
    // builds use the auto-generated debug secret (register it from logcat)
    // and release builds fall back to the attestation providers.
    const debugToken = process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN;
    const useDebugProvider = Boolean(debugToken) || __DEV__;

    const provider = new ReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: {
        provider: useDebugProvider ? "debug" : "playIntegrity",
        ...(debugToken ? { debugToken } : {}),
      },
      apple: {
        provider: useDebugProvider
          ? "debug"
          : "appAttestWithDeviceCheckFallback",
        ...(debugToken ? { debugToken } : {}),
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
