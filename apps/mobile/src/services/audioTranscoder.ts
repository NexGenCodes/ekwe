import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import EkweNative from "../../modules/ekwe-native";

import {
  MAX_AUDIO_BYTES,
  WIT_VORBIS_MAX_DURATION_MS,
} from "@ekwe/shared/plans";
import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";
import logger from "@/utils/logger";

export interface TranscodedAudio {
  uri: string;
  durationMs: number;
  waveform: number[];
}

/** What a worker upload should actually send, and what it owes us afterwards. */
export interface UploadArtifact {
  /** File to hand to the uploader. */
  uri: string;
  /** Extension of `uri`. Resolve the multipart mime from this, not the source. */
  extension: string;
  /** True when `uri` is a throwaway copy the caller must delete when done. */
  isTemporary: boolean;
  /** Opus file kept for playback/sharing. Null when source is already the playback file. */
  playbackUri: string | null;
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

  /**
   * Picks the file an audio upload should send: a throwaway Vorbis copy when
   * Wit.ai can use it, the source otherwise.
   *
   * The gates run before any encode, because a Vorbis file nobody will parse is
   * pure waste. Duration is probed rather than trusted when the caller does not
   * know it, so an unknown length costs a header read and not a full transcode.
   */
  async prepareUploadArtifact(
    sourceUri: string,
    durationMs: number,
    sourceLang: string,
  ): Promise<UploadArtifact> {
    const asIs = (): UploadArtifact => ({
      uri: sourceUri,
      extension: extensionOf(sourceUri),
      isTemporary: false,
      playbackUri: null,
    });

    if (!sourceUri) return asIs();

    let effectiveDuration = durationMs;
    if (effectiveDuration <= 0) {
      effectiveDuration = await EkweNative.probeAudioDurationMs(
        stripFileScheme(sourceUri),
      );
    }

    const sourcePath = stripFileScheme(sourceUri);
    const isAuto = !sourceLang || sourceLang === "auto";
    const isOverCap =
      effectiveDuration <= 0 || effectiveDuration > WIT_VORBIS_MAX_DURATION_MS;
    const needsVorbis = !isAuto && !isOverCap;

    if (needsVorbis) {
      // ≤ 296s and not auto: dual transcode — one decode, both encodes.
      const opusPath = `${Paths.cache.uri}ekwe_opus_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.ogg`;
      const vorbisPath = `${Paths.cache.uri}ekwe_vorbis_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.ogg`;

      try {
        const { opus, vorbis } = await EkweNative.transcodeToDualWithWaveform(
          sourcePath,
          opusPath,
          vorbisPath,
          MAX_AUDIO_BYTES,
        );

        if (!vorbis.success) {
          logger.warn(
            "[AudioTranscoder] Vorbis encode failed, uploading source as-is",
            vorbis.error,
          );
          return asIs();
        }

        if (!opus.success) {
          logger.warn(
            "[AudioTranscoder] Opus encode failed, uploading source as-is",
            opus.error,
          );
          new File(vorbisPath).delete();
          return asIs();
        }

        return {
          uri: vorbisPath,
          extension: "ogg",
          isTemporary: true,
          playbackUri: opusPath,
        };
      } catch (e) {
        logger.warn(
          "[AudioTranscoder] Dual transcode threw, uploading source as-is",
          e instanceof Error ? e.message : String(e),
        );
        return asIs();
      }
    }

    // Auto lang or over cap: Opus only (no Vorbis — Wit rejects it or skips it).
    // The transcodeToOpus fast-path copies the file instead of re-encoding when
    // the source is already mono Ogg Opus.
    const opusPath = `${Paths.cache.uri}ekwe_opus_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.ogg`;
    try {
      const result = await EkweNative.transcodeToOpusWithWaveform(
        sourcePath,
        opusPath,
        MAX_AUDIO_BYTES,
      );
      if (!result.success) {
        logger.warn(
          "[AudioTranscoder] Opus encode failed, uploading source as-is",
          result.error,
        );
        return asIs();
      }
      // If the source was already Opus, the native fast-path copied it, so the
      // opusPath is just a copy. Either way, that file is now the canonical Opus
      // artifact for playback and upload.
      return {
        uri: opusPath,
        extension: "ogg",
        isTemporary: true,
        playbackUri: opusPath,
      };
    } catch (e) {
      logger.warn(
        "[AudioTranscoder] Opus encode threw, uploading source as-is",
        e instanceof Error ? e.message : String(e),
      );
      return asIs();
    }
  }
}

/** Lowercased extension of a path or uri, defaulting to the Ogg we produce. */
function extensionOf(uri: string): string {
  return uri.split(".").pop()?.toLowerCase() || "ogg";
}

function stripFileScheme(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

export const AudioTranscoder = new AudioTranscoderClass();
