import { File as ExpoFile } from "expo-file-system";

import { EkweError } from "@/constants/errors";
import type { ProcessedAudio } from "@/services/AudioProcessor";
import {
  transcribeAudio,
  TranscriptionResult,
} from "@/services/transcribeAudio";
import { Result, err } from "@/types/Result";
import logger from "@/utils/logger";
import {
  MAX_AUDIO_BYTES as MAX_FILE_SIZE,
  PREMIUM_LIMITS,
} from "@ekwe/shared/plans";

export interface BatchAudioInput {
  uri: string;
  durationMs: number;
  meteringData: number[];
  waveform: number[];
}

function computeAverageDb(meteringData: number[]): number {
  if (meteringData.length === 0) return -40;
  return meteringData.reduce((sum, v) => sum + v, 0) / meteringData.length;
}

class BatchTranscriber {
  async transcribe(
    input: BatchAudioInput,
    lang: string,
    signal?: AbortSignal,
    onProgress?: (fraction: number) => void,
  ): Promise<Result<TranscriptionResult, EkweError>> {
    if (!input.uri) {
      logger.error("[BatchTranscriber] No URI provided");
      return err(EkweError.AUDIO_EMPTY);
    }

    if (input.durationMs > 0 && input.durationMs < 500) {
      logger.warn("[BatchTranscriber] Audio too short:", input.durationMs);
      return err(EkweError.TOO_SHORT);
    }

    const file = new ExpoFile(input.uri);
    if (!file.exists) {
      logger.error("[BatchTranscriber] File not found:", input.uri);
      return err(EkweError.SHARE_COPY_FAIL);
    }

    if (file.size && file.size > MAX_FILE_SIZE) {
      logger.warn("[BatchTranscriber] File too large:", file.size);
      return err(EkweError.FILE_TOO_LARGE);
    }

    if (
      input.durationMs > 0 &&
      input.durationMs > PREMIUM_LIMITS.dictationDurationMs
    ) {
      logger.warn("[BatchTranscriber] Audio too long:", input.durationMs);
      return err(EkweError.AUDIO_TOO_LONG);
    }

    const averageDb = computeAverageDb(input.meteringData);

    const processed: ProcessedAudio = {
      uri: input.uri,
      durationMs: input.durationMs,
      averageDb,
      meteringData: input.meteringData,
      waveform: input.waveform,
    };

    return transcribeAudio(processed, lang, signal, onProgress);
  }
}

export const batchTranscriber = new BatchTranscriber();
