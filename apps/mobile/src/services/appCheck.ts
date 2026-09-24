import {
  initializeAppCheck as rnInitializeAppCheck,
  getToken,
  ReactNativeFirebaseAppCheckProvider,
  type AppCheck,
} from "@react-native-firebase/app-check";
import logger from "@/utils/logger";

let initialized = false;
let appCheckInstance: AppCheck | undefined;

export const initializeAppCheck = (): void => {
  if (initialized) return;
  try {
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
        provider: "reCaptchaV3",
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
    if (!appCheckInstance) return null;
    const { token } = await getToken(appCheckInstance, false);
    return token;
  } catch (error) {
    logger.warn("[AppCheck] Failed to get token:", error);
    return null;
  }
};
