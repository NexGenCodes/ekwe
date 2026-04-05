import { Platform } from 'react-native';

import EkweNative, { AudioEffectsResult } from '../../modules/ekwe-native';

/**
 * Attaches Android audio effects (NoiseSuppressor, AcousticEchoCanceler,
 * AutomaticGainControl) to the given audio session. No-op on iOS.
 * Each effect is checked for hardware availability — never throws.
 */
export const attachAudioEffects = async (
  audioSessionId: number,
): Promise<AudioEffectsResult> => {
  if (Platform.OS !== 'android') {
    return {
      noiseSuppressor: false,
      echoCanceler: false,
      gainControl: false,
    };
  }
  try {
    return await EkweNative.attachEffects(audioSessionId);
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
  if (Platform.OS !== 'android') return;
  try {
    await EkweNative.releaseEffects();
  } catch {
    // Swallow — resources may already be released
  }
};
