import { NativeModules, Platform } from 'react-native';

interface AudioEffectsResult {
  noiseSuppressor: boolean;
  echoCanceler: boolean;
  gainControl: boolean;
}

interface AudioEffectsModuleInterface {
  attachEffects: (audioSessionId: number) => Promise<AudioEffectsResult>;
  releaseEffects: () => Promise<void>;
}

const module = NativeModules.AudioEffectsModule as
  | AudioEffectsModuleInterface
  | undefined;

/**
 * Attaches Android audio effects (NoiseSuppressor, AcousticEchoCanceler,
 * AutomaticGainControl) to the given audio session. No-op on iOS.
 * Each effect is checked for hardware availability — never throws.
 */
export const attachAudioEffects = async (
  audioSessionId: number,
): Promise<AudioEffectsResult> => {
  if (Platform.OS !== 'android' || module === undefined) {
    return {
      noiseSuppressor: false,
      echoCanceler: false,
      gainControl: false,
    };
  }
  try {
    return await module.attachEffects(audioSessionId);
  } catch {
    return {
      noiseSuppressor: false,
      echoCanceler: false,
      gainControl: false,
    };
  }
};

/**
 * Releases all audio effects and frees native resources.
 * No-op on iOS. Never throws.
 */
export const releaseAudioEffects = async (): Promise<void> => {
  if (Platform.OS !== 'android' || module === undefined) return;
  try {
    await module.releaseEffects();
  } catch {
    // Swallow — resources may already be released
  }
};
