import { Directory, File, Paths } from "expo-file-system";

import { VOICE_PREVIEW_VERSION } from "@ekwe/shared";

import { logger } from "@/utils";
import { cleanAudioArtifacts } from "@/utils/audioCache";

/**
 * A voice preview is a fixed clip for a fixed (slot, gender): the text is a
 * constant and the worker pins previews to English, so the rendered audio
 * never changes for a given app build. That makes it worth keeping on disk
 * instead of re-downloading it on every tap.
 *
 * The prefix is deliberately absent from `TRANSIENT_CACHE_PREFIXES` so the
 * startup sweep leaves these alone; `clearStalePreviewCache` owns their
 * lifetime instead.
 */
const PREVIEW_PREFIX = "ekwe_vpreview";

const fileNameFor = (key: string, extension: string): string =>
  `${PREVIEW_PREFIX}_v${VOICE_PREVIEW_VERSION}_${key}.${extension}`;

const pathFor = (key: string, extension: string): string | null => {
  try {
    const cacheDir = Paths.cache.uri;
    if (!cacheDir) return null;
    return `${cacheDir}${fileNameFor(key, extension)}`;
  } catch {
    return null;
  }
};

/**
 * `getExtension` in services/speech narrows to wav/mp3, but the pipeline also
 * emits Opus, so the extension is read off the file rather than assumed.
 */
const extensionOf = (uri: string, fallback: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(uri);
  return match?.[1]?.toLowerCase() || fallback;
};

/** The memoized clip for a voice, or null when it has never been fetched. */
export function getCachedPreviewUri(key: string): string | null {
  try {
    const cacheDir = Paths.cache.uri;
    if (!cacheDir) return null;
    for (const extension of ["ogg", "mp3", "wav", "caf"]) {
      const path = pathFor(key, extension);
      if (!path) continue;
      const file = new File(path);
      if (file.exists && file.size > 0) return path;
    }
    return null;
  } catch (err) {
    logger.warn("[voicePreview] Cache lookup failed:", err);
    return null;
  }
}

/**
 * Moves a freshly synthesized clip to its deterministic memo path so the next
 * tap is served from disk. Returns the path to play, falling back to the
 * source when the move cannot happen.
 */
export async function persistPreview(
  sourceUri: string,
  key: string,
): Promise<string> {
  const target = pathFor(key, extensionOf(sourceUri, "ogg"));
  if (!target) return sourceUri;

  try {
    const file = new File(sourceUri);
    if (!file.exists) return sourceUri;

    // The previous clip for this voice is disposable once the new one lands.
    const previous = getCachedPreviewUri(key);
    if (previous) cleanAudioArtifacts(previous);

    await file.move(new File(target), { overwrite: true });
    return target;
  } catch (err) {
    logger.warn("[voicePreview] Persist failed, using temp file:", err);
    return sourceUri;
  }
}

/**
 * Retires memoized previews written by an older app version, so a slot whose
 * resolved voice changed does not keep playing a stale clip.
 */
export async function clearStalePreviewCache(): Promise<void> {
  try {
    const entries = new Directory(Paths.cache).list();
    await Promise.all(
      entries.map(async (entry): Promise<void> => {
        if (!(entry instanceof File)) return;
        if (!entry.name.startsWith(`${PREVIEW_PREFIX}_`)) return;
        if (
          entry.name.startsWith(`${PREVIEW_PREFIX}_v${VOICE_PREVIEW_VERSION}_`)
        ) {
          return;
        }
        await cleanAudioArtifacts(entry.uri);
      }),
    );
  } catch (err) {
    logger.warn("[voicePreview] Stale cache sweep failed:", err);
  }
}
