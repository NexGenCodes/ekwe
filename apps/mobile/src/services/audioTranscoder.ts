import { File, Paths } from "expo-file-system";

import EkweNative from "../../modules/ekwe-native";

import { MAX_AUDIO_BYTES, shouldUploadVorbis } from "@ekwe/shared/plans";
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
        ? inputUri.replace(/^file:\/\//, "")
        : inputUri;

      const result = await EkweNative.resolveAudio(inputPath, {
        opusOutputPath: outputPath,
        maxAudioBytes: MAX_AUDIO_BYTES,
      });

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
   * Returns an M4A uri that the player can open natively for an Ogg Opus
   * `inputUri`, decoding on first use and reusing the result afterwards.
   *
   * Recording only ever writes the Ogg file, so the player derives this copy at
   * play time. The derived name is a stable hash of the source path rather than a
   * random temp, so repeatedly opening the same note reuses one file instead of
   * re-decoding and re-writing it per play. It stays prefixed `ekwe_playback_`
   * so sweepStaleAudioCache() reclaims it once the app stops touching it.
   */
  async createPlaybackCopyForPlayback(
    inputUri: string,
  ): Promise<Result<string, EkweError>> {
    if (!inputUri) return err(EkweError.AUDIO_EMPTY);
    if (!EkweNative.createPlaybackCopy) return err(EkweError.PROCESSOR_FAIL);

    try {
      const cacheDir = Paths.cache.uri;
      if (!cacheDir) return err(EkweError.PROCESSOR_FAIL);

      const inputPath = inputUri.startsWith("file://")
        ? inputUri.slice("file://".length)
        : inputUri;
      const outputPath = `${cacheDir}ekwe_playback_${stableHash(inputPath)}.m4a`;

      if (new File(outputPath).exists) {
        return ok(outputPath);
      }

      const success = await EkweNative.createPlaybackCopy(
        inputPath,
        outputPath,
        MAX_AUDIO_BYTES,
      );

      if (!success) return err(EkweError.PROCESSOR_FAIL);
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
    const needsVorbis = shouldUploadVorbis(effectiveDuration, sourceLang);

    // DEBUG: proves the Vorbis-vs-Opus decision inputs. Remove after verifying.
    logger.debug(
      "[Upload] decision:",
      JSON.stringify({
        source: sourceUri.slice(-48),
        knownDurationMs: durationMs,
        effectiveDurationMs: effectiveDuration,
        sourceLang,
        needsVorbis,
        isOwnOpus: isOwnOpus(sourceUri),
      }),
    );

    if (!needsVorbis && isOwnOpus(sourceUri)) {
      return asIs();
    }

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const opusPath = `${Paths.cache.uri}ekwe_opus_${stamp}.ogg`;
    const vorbisPath = needsVorbis
      ? `${Paths.cache.uri}ekwe_vorbis_${stamp}.ogg`
      : null;

    const cleanupTemps = (): void => {
      for (const path of [opusPath, vorbisPath]) {
        if (!path) continue;
        try {
          const file = new File(path);
          if (file.exists) file.delete();
        } catch {
          /* stale cache entries are reclaimed by sweepStaleAudioCache() */
        }
      }
    };

    try {
      const result = await EkweNative.resolveAudio(sourcePath, {
        opusOutputPath: opusPath,
        vorbisOutputPath: vorbisPath,
        maxAudioBytes: MAX_AUDIO_BYTES,
      });

      if (!result.success) {
        logger.warn(
          "[AudioTranscoder] resolveAudio failed, uploading source as-is",
          result.error,
        );
        // DEBUG: `result.durationMs` is the native MediaMetadataRetriever probe.
        // Compare with the granule-based probe to spot encoder sentinel misprobes.
        // Remove after confirming.
        logger.warn(
          "[ProbeDebug] resolveAudio (prepareUploadArtifact):",
          JSON.stringify({
            error: result.error,
            metadataProbeMs: result.durationMs,
            granuleProbeMs: await EkweNative.probeAudioDurationMs(sourcePath),
            knownDurationMs: durationMs,
            effectiveDurationMs: effectiveDuration,
            sourcePath,
          }),
        );
        cleanupTemps();
        return asIs();
      }

      if (needsVorbis && !result.vorbisSuccess) {
        logger.warn(
          "[AudioTranscoder] Vorbis encode failed, uploading source as-is",
        );
        cleanupTemps();
        return asIs();
      }

      const uploadUri = needsVorbis && vorbisPath ? vorbisPath : opusPath;
      // DEBUG: confirms which file is uploaded and that the Vorbis file exists
      // with content. Remove after verifying.
      logger.debug(
        "[Upload] artifact:",
        JSON.stringify({
          upload: uploadUri.slice(-48),
          isVorbis: uploadUri === vorbisPath,
          vorbisSuccess: result.vorbisSuccess,
          vorbisBytes: vorbisPath ? new File(vorbisPath).size : 0,
          opusBytes: new File(opusPath).size,
        }),
      );

      return {
        uri: uploadUri,
        extension: "ogg",
        isTemporary: true,
        playbackUri: opusPath,
      };
    } catch (e) {
      logger.warn(
        "[AudioTranscoder] resolveAudio threw, uploading source as-is",
        e instanceof Error ? e.message : String(e),
      );
      cleanupTemps();
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

/** True for a file this class produced as its transcoded Opus output. */
function isOwnOpus(uri: string): boolean {
  return /(^|\/)ekwe_opus_[^/]+\.ogg$/i.test(stripFileScheme(uri));
}

export const AudioTranscoder = new AudioTranscoderClass();
