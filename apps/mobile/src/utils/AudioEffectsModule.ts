import { isAndroid } from "@/utils/platform";
import EkweNative from "../../modules/ekwe-native";

export const releaseAudioEffects = async (): Promise<void> => {
  if (!isAndroid) return;
  try {
    await EkweNative.releaseEffects();
  } catch {
    // Swallow — resources may already be released
  }
};
