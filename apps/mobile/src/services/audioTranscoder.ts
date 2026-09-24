import { Paths } from "expo-file-system";
import { Platform } from "react-native";

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

      const outputPath = `${cacheDir}ekwe_converted_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.ogg`;

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
        if (result.error === "AUDIO_TOO_LONG") {
          return err(EkweError.AUDIO_TOO_LONG);
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

  async decodeToWav(
    inputUri: string,
  ): Promise<Result<TranscodedAudio, EkweError>> {
    if (Platform.OS !== "ios") {
      return err(EkweError.PROCESSOR_FAIL);
    }
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.PROCESSOR_FAIL);

      const outputPath = `${cacheDir}ekwe_decoded_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.wav`;

      const inputPath = inputUri.startsWith("file://")
        ? inputUri.slice("file://".length)
        : inputUri;

      const result = await EkweNative.decodeAudioToWav(
        inputPath,
        outputPath,
        MAX_AUDIO_BYTES,
      );

      if (!result.success) {
        if (result.error === "FILE_TOO_LARGE") {
          return err(EkweError.FILE_TOO_LARGE);
        }
        if (result.error === "AUDIO_TOO_LONG") {
          return err(EkweError.AUDIO_TOO_LONG);
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

  async remuxToCaf(
    inputUri: string,
  ): Promise<Result<TranscodedAudio, EkweError>> {
    if (Platform.OS !== "ios") {
      return err(EkweError.PROCESSOR_FAIL);
    }
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.PROCESSOR_FAIL);

      const outputPath = `${cacheDir}ekwe_remuxed_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.caf`;

      const inputPath = inputUri.startsWith("file://")
        ? inputUri.slice("file://".length)
        : inputUri;

      const result = await EkweNative.remuxToCaf(
        inputPath,
        outputPath,
        MAX_AUDIO_BYTES,
      );

      if (!result.success) {
        if (result.error === "FILE_TOO_LARGE") {
          return err(EkweError.FILE_TOO_LARGE);
        }
        if (result.error === "AUDIO_TOO_LONG") {
          return err(EkweError.AUDIO_TOO_LONG);
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
