import * as FileSystem from 'expo-file-system';
import { EkweError } from 'src/constants/errors';
import { Result, ok, err } from 'src/types/Result';

const SPEECH_THRESHOLD = 0.05; // amplitude 0–1
const SILENCE_PAD_MS = 100; // padding around speech boundaries
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB in bytes

export interface ProcessedAudio {
  uri: string;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  hasSpeech: boolean;
  averageAmplitude: number;
  meteringData: number[];
}

export interface AudioQualityReport {
  hasSpeech: boolean;
  averageAmplitude: number;
  isLowQuality: boolean;
  trimStartMs: number;
  trimEndMs: number;
}

class AudioProcessorClass {
  /**
   * Analyses metering data collected during recording.
   * Identifies speech boundaries using amplitude thresholding.
   * Returns trim points and quality metrics.
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

    const speechSamples = meteringData.filter((v) => v > SPEECH_THRESHOLD);

    if (speechSamples.length === 0) {
      return err(EkweError.NO_SPEECH);
    }

    // Find first and last speech sample indices
    let firstSpeech = -1;
    let lastSpeech = -1;

    for (let i = 0; i < meteringData.length; i++) {
      if (meteringData[i] > SPEECH_THRESHOLD) {
        if (firstSpeech === -1) firstSpeech = i;
        lastSpeech = i;
      }
    }

    // Convert sample indices to milliseconds
    const trimStartMs = Math.max(0, firstSpeech * intervalMs - SILENCE_PAD_MS);
    const trimEndMs = (lastSpeech + 1) * intervalMs + SILENCE_PAD_MS;

    const isLowQuality = average < 0.1;

    return ok({
      hasSpeech: true,
      averageAmplitude: average,
      isLowQuality,
      trimStartMs,
      trimEndMs,
    });
  }

  /**
   * Validates a recording result before sending to Groq.
   * Checks duration, speech presence, and file integrity.
   * Returns the processed audio ready for transcription.
   */
  async processRecording(
    uri: string,
    durationMs: number,
    meteringData: number[],
  ): Promise<Result<ProcessedAudio, EkweError>> {
    if (durationMs < 500) return err(EkweError.TOO_SHORT);
    if (uri.length === 0) return err(EkweError.AUDIO_EMPTY);

    const qualityResult = this.analyseMetering(meteringData, 100);

    if (!qualityResult.ok) return err(qualityResult.error);

    const quality = qualityResult.value;

    const processed: ProcessedAudio = {
      uri,
      durationMs,
      trimStartMs: quality.trimStartMs,
      trimEndMs: quality.trimEndMs,
      hasSpeech: quality.hasSpeech,
      averageAmplitude: quality.averageAmplitude,
      meteringData,
    };

    // Return with a low quality warning attached to the result
    // but still return ok — low quality is not a hard failure.
    // The Transcription service checks processed.averageAmplitude
    // and may add a LOW_QUALITY warning to the final result.
    return ok(processed);
  }

  /**
   * Validates a shared file path before sending to Groq.
   * Checks the file exists and is within Groq's 25MB limit.
   */
  async validateSharedFile(
    uri: string,
  ): Promise<Result<{ uri: string }, EkweError>> {
    if (!uri) return err(EkweError.SHARE_COPY_FAIL);

    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        return err(EkweError.SHARE_COPY_FAIL);
      }

      if (info.size > MAX_FILE_SIZE) {
        return err(EkweError.FILE_TOO_LARGE);
      }

      return ok({ uri });
    } catch {
      return err(EkweError.SHARE_COPY_FAIL);
    }
  }
}

export const AudioProcessor = new AudioProcessorClass();
