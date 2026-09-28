import { File, Paths } from "expo-file-system";
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

/**
 * FNV-1a, rendered base-36. Only needs to be stable and low-collision across
 * app launches (it names a derived cache file), not cryptographically strong,
 * so this avoids pulling in a hashing dependency for a few bytes of path.
 */
const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

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

  /**
   * Returns a CAF uri that AVPlayer/expo-audio can open natively for an Ogg
   * Opus `inputUri`, remuxing on first use and reusing the result afterwards.
   *
   * Recording only ever writes the Ogg file, so iOS derives this copy at play
   * time. The derived name is a stable hash of the source path rather than a
   * random temp, so repeatedly opening the same note reuses one file instead of
   * remuxing and re-writing it per play. It stays prefixed `ekwe_remuxed_` so
   * sweepStaleAudioCache() reclaims it once the app stops touching it.
   */
  async remuxToCafForPlayback(
    inputUri: string,
  ): Promise<Result<string, EkweError>> {
    if (Platform.OS !== "ios") {
      return err(EkweError.PROCESSOR_FAIL);
    }
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.PROCESSOR_FAIL);

      const inputPath = inputUri.startsWith("file://")
        ? inputUri.slice("file://".length)
        : inputUri;
      const outputPath = `${cacheDir}ekwe_remuxed_${stableHash(inputPath)}.caf`;

      if (new File(outputPath).exists) {
        return ok(outputPath);
      }

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

      return ok(outputPath);
    } catch {
      return err(EkweError.PROCESSOR_FAIL);
    }
  }
}

export const AudioTranscoder = new AudioTranscoderClass();
