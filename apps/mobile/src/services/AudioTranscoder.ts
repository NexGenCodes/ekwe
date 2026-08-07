import { Paths } from "expo-file-system";

import EkweNative from "../../modules/ekwe-native";

import { MAX_AUDIO_BYTES } from "@ekwe/shared/plans";
import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";

export interface TranscodedAudio {
  uri: string;
  durationMs: number;
  waveform: number[];
}

class AudioTranscoderClass {
  async transcodeToOpus(
    inputUri: string,
  ): Promise<Result<TranscodedAudio, EkweError>> {
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.PROCESSOR_FAIL);

      const outputPath = `${cacheDir}ekwe_converted_${Date.now()}.ogg`;

      // The iOS share extension hands us a file:// URL; the C++ decoder (and
      // Android's resolvePath) expects a plain filesystem path.
      const inputPath = inputUri.startsWith("file://")
        ? inputUri.slice("file://".length)
        : inputUri;

      const result = await EkweNative.transcodeToOpusWithWaveform(
        inputPath,
        outputPath,
        MAX_AUDIO_BYTES,
      );

      if (!result.success) {
        if (result.error === "FILE_TOO_LARGE") {
          return err(EkweError.FILE_TOO_LARGE);
        }
        return err(EkweError.PROCESSOR_FAIL);
      }

      return ok({
        uri: outputPath,
        durationMs: result.durationMs,
        waveform: result.waveform,
      });
    } catch {
      return err(EkweError.PROCESSOR_FAIL);
    }
  }
}

export const AudioTranscoder = new AudioTranscoderClass();
