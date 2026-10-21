import { File, Paths } from "expo-file-system";

import { logger } from "@/utils";
import { cleanEchoCache } from "@/utils/audioCache";

/**
 * Disk cache prefix for Echo TTS clips. Included in the startup sweep's
 * transient prefixes so memos from a previous session are reclaimed on boot.
 */
const ECHO_SPEECH_PREFIX = "ekwe_espeak";

/**
 * Bump to invalidate every memoized Echo TTS clip on clients. Needed when
 * the synthesis pipeline's output changes incompatibly (provider swap,
 * encoding change, voice-slot re-resolution).
 */
const ECHO_SPEECH_VERSION = 1;

const fileNameFor = (key: string, extension: string): string =>
  `${ECHO_SPEECH_PREFIX}_v${ECHO_SPEECH_VERSION}_${key}.${extension}`;

const pathFor = (key: string, extension: string): string | null => {
  try {
    const cacheDir = Paths.cache.uri;
    if (!cacheDir) return null;
    return `${cacheDir}${fileNameFor(key, extension)}`;
  } catch {
    return null;
  }
};

const extensionOf = (uri: string, fallback: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(uri);
  return match?.[1]?.toLowerCase() || fallback;
};

/**
 * FNV-1a, rendered base-36. Only needs to be stable and low-collision across
 * app launches (it names a memoized clip), not cryptographically strong.
 */
export const echoSpeechCacheKey = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/** The memoized clip for this synthesis key, or null when it has never been fetched. */
export function getCachedEchoSpeechUri(key: string): string | null {
  try {
    const cacheDir = Paths.cache.uri;
    if (!cacheDir) return null;
    for (const extension of ["mp3", "ogg", "wav"]) {
      const path = pathFor(key, extension);
      if (!path) continue;
      const file = new File(path);
      if (file.exists && file.size > 0) return path;
    }
    return null;
  } catch (err) {
    logger.warn("[echoSpeech] Cache lookup failed:", err);
    return null;
  }
}

/** Moves a synthesized clip to its deterministic memo path. Falls back to the source URI on failure. */
export async function persistEchoSpeech(
  sourceUri: string,
  key: string,
): Promise<string> {
  const target = pathFor(key, extensionOf(sourceUri, "mp3"));
  if (!target) return sourceUri;

  try {
    const file = new File(sourceUri);
    if (!file.exists) return sourceUri;

    // The previous clip for this key is disposable once the new one lands.
    const previous = getCachedEchoSpeechUri(key);
    if (previous && previous !== target) void cleanEchoCache(previous);

    await file.move(new File(target), { overwrite: true });
    return target;
  } catch (err) {
    logger.warn("[echoSpeech] Persist failed, using temp file:", err);
    return sourceUri;
  }
}
