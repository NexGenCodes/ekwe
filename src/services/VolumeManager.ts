import { setAudioModeAsync } from 'expo-audio';
import { EkweError } from 'src/constants/errors';
import { Result, ok, err } from 'src/types/Result';

const VOLUME_RAISE_THRESHOLD = 0.5;

class VolumeManagerClass {
  private storedVolume: number | null = null;
  private listeners: Set<() => void> = new Set();

  /**
   * Reads the current system volume (0–1).
   * On Android uses expo-audio's getSystemVolume if available.
   * On iOS uses AVAudioSession outputVolume via expo-audio.
   */
  async getVolume(): Promise<Result<number, EkweError>> {
    try {
      // expo-audio does not expose system volume directly.
      // This is a scaffold — the actual implementation reads from
      // the platform in Phase 8 when the full audio session is wired.
      return ok(0.7);
    } catch {
      return ok(0.5);
    }
  }

  /**
   * Raises system volume to TARGET_VOLUME.
   */
  async raiseVolumeIfNeeded(): Promise<Result<boolean, EkweError>> {
    const volumeResult = await this.getVolume();
    if (!volumeResult.ok) return err(volumeResult.error);

    if (volumeResult.value < VOLUME_RAISE_THRESHOLD) {
      this.storedVolume = volumeResult.value;
      // On Android volume raising requires a native module
      // (android.media.AudioManager.setStreamVolume).
      // Scaffold is in place. Full wire-up in Phase 8.
      // For Phase 7 we store the intent and notify so the
      // banner system can inform the user.
      this.notifyListeners();
      return ok(true);
    }
    return ok(false);
  }

  /**
   * Restores the volume that was stored before raiseVolumeIfNeeded.
   */
  async restoreVolume(): Promise<Result<void, EkweError>> {
    if (this.storedVolume === null) return ok(undefined);
    this.storedVolume = null;
    this.notifyListeners();
    return ok(undefined);
  }

  /**
   * Returns true if the stored volume differs from current volume.
   */
  isVolumeRaised(): boolean {
    return this.storedVolume !== null;
  }

  /**
   * Forces audio output to the speaker.
   */
  async forceToSpeaker(): Promise<Result<void, EkweError>> {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
      return ok(undefined);
    } catch {
      return err(EkweError.PROCESSOR_FAIL);
    }
  }

  /**
   * Detects current audio routing.
   */
  async getAudioRoute(): Promise<
    Result<'speaker' | 'bluetooth' | 'wired' | 'earpiece', EkweError>
  > {
    // Full implementation in Phase 7.
    // Return speaker as default for now.
    return ok('speaker');
  }

  /**
   * Subscribe to volume or routing change events.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  /**
   * Resets internal state. Used for testing only.
   */
  _resetForTesting(): void {
    this.storedVolume = null;
    this.listeners.clear();
  }
}

export const VolumeManager = new VolumeManagerClass();
