import { isAndroid } from "./platform";
import EkweNative from "../../modules/ekwe-native";

/**
 * Releases all audio effects and frees native resources.
 * No-op on iOS. Never throws.
 */
export const releaseAudioEffects = async (): Promise<void> => {
  if (!isAndroid) return;
  try {
    await EkweNative.releaseEffects();
  } catch {
    // Swallow — resources may already be released
  }
};
