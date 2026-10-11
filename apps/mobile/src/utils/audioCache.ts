import { Directory, File, Paths } from "expo-file-system";

import { isAndroid } from "@/utils/platform";
import EkweNative from "../../modules/ekwe-native";

import { logger } from "@/utils";

const isCacheUri = (uri: string): boolean => {
  try {
    const cache = Paths.cache.uri;
    return uri.startsWith(cache);
  } catch {
    return uri.includes("/Cache/") || uri.includes("/cache/");
  }
};

const AUDIO_SIBLING_EXTENSIONS = ["ogg", "caf", "wav"] as const;

export const cleanEchoCache = async (
  uri: string | null | undefined,
): Promise<void> => {
  if (!uri) return;

  // expo-file-system can address anything inside the cache on both platforms, so
  // it is the primary path. The native module is a *fallback*, not an addition:
  // on Android it resolves to the very same java.io.File.delete(), and the
  // recorder writes through it, so an open AudioRecord handle can keep the file
  // alive long enough for the JS-side delete to fail. Running both
  // unconditionally deleted every cache file twice through two different APIs.
  let needsNativeFallback = isAndroid;

  try {
    if (isCacheUri(uri)) {
      const f = new File(uri);
      if (f.exists) {
        f.delete();
      }
      needsNativeFallback = false;
    }
  } catch (err) {
    // Leave the fallback armed so Android still gets a second attempt through
    // the module that created the file.
    logger.error("[AudioCache] Cache cleanup failed:", err);
  }

  if (needsNativeFallback) {
    try {
      await EkweNative.deleteFile(uri);
    } catch (err) {
      logger.error("[AudioCache] Native cleanup failed:", err);
    }
  }
};

export const cleanAudioArtifacts = async (
  uri: string | null | undefined,
): Promise<void> => {
  if (!uri) return;

  const variants = new Set<string>([uri]);
  const match = uri.match(/^(.*)\.(ogg|caf|wav)$/i);
  if (match) {
    const [, base, ext] = match;
    for (const candidate of AUDIO_SIBLING_EXTENSIONS) {
      if (candidate !== ext.toLowerCase()) {
        variants.add(`${base}.${candidate}`);
      }
    }
  }

  await Promise.all(Array.from(variants).map((v) => cleanEchoCache(v)));
};

const TRANSIENT_CACHE_PREFIXES = [
  "ekwe_recording_",
  "ekwe_speech_",
  "ekwe_converted_",
  "ekwe_decoded_",
  "ekwe_opus_",
  "ekwe_vorbis_",
  "ekwe_playback_",
  // Outgoing share copies made by ShareOutService.prepareShareFile.
  "ekwe-voice-",
];

const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

const isTransientEchoFile = (name: string): boolean =>
  TRANSIENT_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));

export const sweepStaleAudioCache = async (): Promise<void> => {
  try {
    const entries = new Directory(Paths.cache).list();
    const cutoff = Date.now() - SWEEP_MIN_AGE_MS;

    await Promise.all(
      entries.map(async (entry): Promise<void> => {
        if (!(entry instanceof File)) return;
        if (!isTransientEchoFile(entry.name)) return;
        const modified = entry.modificationTime;
        if (typeof modified === "number" && modified > cutoff) return;
        await cleanEchoCache(entry.uri);
      }),
    );
  } catch (err) {
    logger.error("[AudioCache] Cache sweep failed:", err);
  }
};
