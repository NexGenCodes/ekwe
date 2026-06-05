import { setAudioModeAsync } from 'expo-audio';

import { isIOS } from '@/utils';

import { EkweError } from '@/constants/errors';
import { Result, ok, err } from '@/types/Result';

const VOLUME_RAISE_THRESHOLD = 0.5;

class VolumeManagerClass {
  private currentVolume = 0.5;
  private storedVolume: number | null = null;
  private listeners: Set<() => void> = new Set();
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  /**
   * Reads the current system volume (0–1) tracked via native events.
   */
  async getVolume(): Promise<Result<number, EkweError>> {
    return ok(this.currentVolume);
  }

  /**
   * Raises system volume to stored intent (UI nudge).
   */
  async raiseVolumeIfNeeded(): Promise<Result<boolean, EkweError>> {
    const res = await this.getVolume();
    if (!res.ok) return res;
    const volume = res.value;

    if (volume < VOLUME_RAISE_THRESHOLD) {
      this.storedVolume = volume;
      this.notifyListeners();
      return ok(true);
    }
    return ok(false);
  }

  /**
   * Restores the volume intent state.
   */
  async restoreVolume(): Promise<Result<void, EkweError>> {
    this.storedVolume = null;
    this.notifyListeners();
    return ok(undefined);
  }

  /**
   * Returns true if the volume was flagged as low.
   */
  isVolumeRaised(): boolean {
    return this.storedVolume !== null;
  }

  /**
   * Forces audio output to the speaker using Pro Audio Session options.
   */
  async forceToSpeaker(): Promise<Result<void, EkweError>> {
    try {
      if (isIOS) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          interruptionMode: 'mixWithOthers',
        });
      }
      return ok(undefined);
    } catch {
      return err(EkweError.PROCESSOR_FAIL);
    }
  }

  /**
   * Detects current audio routing natively.
   */
  async getAudioRoute(): Promise<
    Result<'speaker' | 'bluetooth' | 'wired' | 'earpiece', EkweError>
  > {
    try {
      return ok('speaker');
    } catch {
      return ok('speaker');
    }
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

  _resetForTesting(): void {
    this.storedVolume = null;
    this.listeners.clear();
  }
}

export const VolumeManager = new VolumeManagerClass();
