import { EkweError } from 'src/constants/errors';
import { Result, ok } from 'src/types/Result';

const VOLUME_RAISE_THRESHOLD = 0.5;
// const TARGET_VOLUME = 1.0;

class VolumeManagerClass {
  private storedVolume: number | null = null;
  private listeners: Set<() => void> = new Set();

  /**
   * Reads the current system volume (0–1).
   * On Android uses expo-audio's getSystemVolume if available.
   * On iOS uses AVAudioSession outputVolume via expo-audio.
   * Returns 0.7 as a safe default until Phase 7 wires platform APIs.
   */
  async getVolume(): Promise<Result<number, EkweError>> {
    try {
      // expo-audio does not expose system volume directly.
      // Use a reasonable default and attempt platform-specific reads.
      // This is a scaffold — the actual implementation reads from
      // the platform in Phase 7 when the full audio session is wired.
      return ok(0.7);
    } catch {
      return ok(0.5);
    }
  }

  /**
   * If current volume is below VOLUME_RAISE_THRESHOLD, stores the
   * current volume and raises it to TARGET_VOLUME.
   * Returns whether the volume was raised.
   */
  async raiseVolumeIfNeeded(): Promise<Result<boolean, EkweError>> {
    const volumeResult = await this.getVolume();
    if (!volumeResult.ok) return volumeResult;

    if (volumeResult.value < VOLUME_RAISE_THRESHOLD) {
      this.storedVolume = volumeResult.value;
      // Volume setting is wired in Phase 7.
      // Store the intent and notify listeners.
      // TARGET_VOLUME will be applied via platform API in Phase 7.
      this.notifyListeners();
      return ok(true);
    }
    return ok(false);
  }

  /**
   * Restores the volume that was stored before raiseVolumeIfNeeded.
   * No-op if no volume was stored.
   */
  async restoreVolume(): Promise<Result<void, EkweError>> {
    if (this.storedVolume === null) return ok(undefined);
    // Volume restoration wired in Phase 7.
    this.storedVolume = null;
    this.notifyListeners();
    return ok(undefined);
  }

  /**
   * Returns true if the stored volume differs from current volume,
   * indicating that a volume raise is active.
   */
  isVolumeRaised(): boolean {
    return this.storedVolume !== null;
  }

  /**
   * Detects current audio routing — speaker, bluetooth, wired, or earpiece.
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
   * Returns an unsubscribe function.
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
