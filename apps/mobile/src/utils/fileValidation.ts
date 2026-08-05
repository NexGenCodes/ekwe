import { File as ExpoFile, FileMode } from "expo-file-system";

import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";
import { MAX_AUDIO_BYTES as MAX_FILE_SIZE } from "@ekwe/shared/plans";

export { MAX_FILE_SIZE };

export const VOICE_NOTE_EXTENSIONS = [
  ".ogg",
  ".opus",
  ".m4a",
  ".aac",
  ".amr",
  ".3gp",
];

export const VOICE_NOTE_MIME_TYPES = [
  "audio/ogg",
  "audio/opus",
  "audio/x-opus",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/x-aac",
  "audio/amr",
  "audio/amr-wb",
  "audio/3gpp",
  "audio/3gp",
  "audio/mp4",
];

/**
 * Validates if the given URI has a valid voice-note extension or MIME type.
 * WhatsApp often provides "audio/ogg; codecs=opus".
 */
export const validateVoiceNoteFormat = (
  uri: string,
  mimeType?: string,
): boolean => {
  const lowerUri = uri.toLowerCase();
  const hasExt = VOICE_NOTE_EXTENSIONS.some((ext) => lowerUri.endsWith(ext));
  if (hasExt) return true;

  if (mimeType) {
    const lowerMime = mimeType.toLowerCase();
    return VOICE_NOTE_MIME_TYPES.some((m) => lowerMime.includes(m));
  }

  return false;
};

/**
 * Checks if the file exists and is within the size limit using the modern JSI File API.
 */
export const validateFileSize = async (
  uri: string,
  maxSize = MAX_FILE_SIZE,
): Promise<Result<boolean, EkweError>> => {
  try {
    const file = new ExpoFile(uri);

    // Synchronous JSI property access
    if (!file.exists) {
      return err(EkweError.SHARE_COPY_FAIL);
    }
    const size = file.size;
    if (size && size > maxSize) {
      return err(EkweError.FILE_TOO_LARGE);
    }
    return ok(true);
  } catch {
    return err(EkweError.SHARE_COPY_FAIL);
  }
};

/**
 * PRO-LEVEL: Magic Bytes Sniffing.
 * Verifies if the file actually contains audio headers.
 * Updated for better OggOpus and modern M4A support.
 */
export const sniffAudioHeader = async (uri: string): Promise<boolean> => {
  try {
    // Read only the first 12 bytes using FileHandle to avoid out-of-memory crashes on large files.
    const file = new ExpoFile(uri);
    if (!file.exists) return false;
    const handle = file.open(FileMode.ReadOnly);
    const rawBytes = handle.readBytes(12);
    handle.close();

    let binary = "";
    for (let i = 0; i < rawBytes.length; i++) {
      binary += String.fromCharCode(rawBytes[i]);
    }
    const header = btoa(binary);
    if (!header) return false;

    const signatures = [
      "T2dnUw", // "OggS"
      "OpusHead",
      "ZnR5c", // "ftyp" (MP4/M4A)
      "I0FNUg", // "#!AMR"
      "UklGR", // "RIFF" (WAV)
    ];

    // Also check for raw "OpusHead" text if base64 decoding isn't yielding exact match
    return signatures.some((sig) => header.includes(sig));
  } catch {
    return false;
  }
};

/**
 * Combined validation pipeline for shared audio files.
 */
export const validateSharedAudio = async (
  uri: string,
  mimeType?: string,
): Promise<Result<{ uri: string }, EkweError>> => {
  if (uri.length === 0) return err(EkweError.SHARE_COPY_FAIL);

  // PRO-LEVEL: If mimeType is the generic 'application/octet-stream' (common for WhatsApp),
  // we proceed directly to sniffing rather than failing early.
  const isGeneric = mimeType?.toLowerCase() === "application/octet-stream";

  if (!isGeneric && !validateVoiceNoteFormat(uri, mimeType)) {
    return err(EkweError.BAD_FORMAT);
  }

  const sizeResult = await validateFileSize(uri);
  if (!sizeResult.ok) {
    return err(sizeResult.error);
  }

  const isSniffed = await sniffAudioHeader(uri);
  if (!isSniffed) {
    // If it's a generic stream and sniffing fails, it's definitely not one of ours.
    return err(EkweError.BAD_FORMAT);
  }

  return ok({ uri });
};
