import { Paths } from "expo-file-system";

import EkweNative from "../../modules/ekwe-native";

import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";

export interface ConvertedAudio {
  uri: string;
  durationMs: number;
  waveform: number[];
}

class AudioConverterClass {
  async convertToOpus(
    inputUri: string,
  ): Promise<Result<ConvertedAudio, EkweError>> {
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.AUDIO_RECORD_FAIL);

      const outputPath = `${cacheDir}ekwe_converted_${Date.now()}.ogg`;

      const result = await EkweNative.extractWavAndWaveform(
        inputUri,
        outputPath,
      );

      if (!result.success) {
        return err(EkweError.AUDIO_RECORD_FAIL);
      }

      return ok({
        uri: outputPath,
        durationMs: result.durationMs,
        waveform: result.waveform,
      });
    } catch {
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  }
}

export const AudioConverter = new AudioConverterClass();
