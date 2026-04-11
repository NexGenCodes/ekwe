import { File as ExpoFile } from 'expo-file-system';

import { EkweError } from '@/constants/errors';
import { Result, ok, err } from '@/types/Result';

const SPEECH_THRESHOLD_DB = -45; // dB threshold for speech presence
const LOW_QUALITY_THRESHOLD_DB = -60; // dB threshold for quality warning
const SILENCE_PAD_MS = 100; // padding around speech boundaries
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB in bytes

export interface ProcessedAudio {
  uri: string;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  hasSpeech: boolean;
  averageDb: number;
  meteringData: number[];
}

export interface AudioQualityReport {
  hasSpeech: boolean;
  averageDb: number;
  isLowQuality: boolean;
  trimStartMs: number;
  trimEndMs: number;
}

class AudioProcessorClass {
  /**
   * Analyses metering data (in dB) collected during recording.
   * Identifies speech boundaries using dB thresholding.
   */
  analyseMetering(
    meteringData: number[],
    intervalMs: number,
  ): Result<AudioQualityReport, EkweError> {
    if (meteringData.length === 0) {
      return err(EkweError.AUDIO_EMPTY);
    }

    const average =
      meteringData.reduce((sum, v) => sum + v, 0) / meteringData.length;

    const speechSamples = meteringData.filter((v) => v > SPEECH_THRESHOLD_DB);

    if (speechSamples.length === 0) {
      return err(EkweError.NO_SPEECH);
    }

    // Find first and last speech sample indices
    let firstSpeech = -1;
    let lastSpeech = -1;

    for (let i = 0; i < meteringData.length; i++) {
      if (meteringData[i] > SPEECH_THRESHOLD_DB) {
        if (firstSpeech === -1) firstSpeech = i;
        lastSpeech = i;
      }
    }

    // Convert sample indices to milliseconds
    const trimStartMs = Math.max(0, firstSpeech * intervalMs - SILENCE_PAD_MS);
    const trimEndMs = (lastSpeech + 1) * intervalMs + SILENCE_PAD_MS;

    const isLowQuality = average < LOW_QUALITY_THRESHOLD_DB;

    return ok({
      hasSpeech: true,
      averageDb: average,
      isLowQuality,
      trimStartMs,
      trimEndMs,
    });
  }

  /**
   * Validates a recording result before sending to Groq.
   */
  async processRecording(
    uri: string,
    durationMs: number,
    meteringData: number[],
  ): Promise<Result<ProcessedAudio, EkweError>> {
    if (durationMs < 500) return err(EkweError.TOO_SHORT);
    if (!uri) return err(EkweError.AUDIO_EMPTY);

    const qualityResult = this.analyseMetering(meteringData, 32); // Consistent 32ms polling

    if (!qualityResult.ok) return err(qualityResult.error);

    const quality = qualityResult.value;

    const processed: ProcessedAudio = {
      uri,
      durationMs,
      trimStartMs: quality.trimStartMs,
      trimEndMs: quality.trimEndMs,
      hasSpeech: quality.hasSpeech,
      averageDb: quality.averageDb,
      meteringData,
    };

    return ok(processed);
  }

  /**
   * Validates a shared file path using modern SDK 55 APIs.
   */
  async validateSharedFile(
    uri: string,
  ): Promise<Result<{ uri: string }, EkweError>> {
    if (!uri) return err(EkweError.SHARE_COPY_FAIL);

    try {
      const file = new ExpoFile(uri);

      // JSI metadata access
      if (!file.exists) {
        return err(EkweError.SHARE_COPY_FAIL);
      }

      if (file.size && file.size > MAX_FILE_SIZE) {
        return err(EkweError.FILE_TOO_LARGE);
      }

      return ok({ uri });
    } catch {
      return err(EkweError.SHARE_COPY_FAIL);
    }
  }
}

export const AudioProcessor = new AudioProcessorClass();
