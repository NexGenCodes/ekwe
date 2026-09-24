import { File as ExpoFile } from "expo-file-system";

import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";
import { MAX_AUDIO_BYTES as MAX_FILE_SIZE } from "@ekwe/shared/plans";

export interface ProcessedAudio {
  uri: string;
  durationMs: number;
  averageDb: number;
  meteringData: number[];
  waveform: number[];
}

class AudioProcessorClass {
  async processRecording(
    uri: string,
    durationMs: number,
    meteringData: number[],
    waveform?: number[],
  ): Promise<Result<ProcessedAudio, EkweError>> {
    if (durationMs < 500) return err(EkweError.TOO_SHORT);
    if (!uri) return err(EkweError.AUDIO_EMPTY);

    const averageDb =
      meteringData.length > 0
        ? meteringData.reduce((sum, v) => sum + v, 0) / meteringData.length
        : -160;

    const processed: ProcessedAudio = {
      uri,
      durationMs,
      averageDb,
      meteringData,
      waveform: waveform ?? [],
    };

    return ok(processed);
  }

  async validateSharedFile(
    uri: string,
  ): Promise<Result<{ uri: string }, EkweError>> {
    if (!uri) return err(EkweError.SHARE_COPY_FAIL);

    try {
      const file = new ExpoFile(uri);

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
