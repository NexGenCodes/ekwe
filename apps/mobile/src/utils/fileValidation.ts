import { File as ExpoFile, FileMode } from "expo-file-system";

import { EkweError } from "@/constants/errors";
import { Result, ok, err } from "@/types/Result";
import { auth$ } from "@/store";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared/plans";

const VOICE_NOTE_EXTENSIONS = [
  ".ogg",
  ".opus",
  ".m4a",
  ".aac",
  ".amr",
  ".3gp",
  ".wav",
  ".flac",
  ".mp3",
  ".aiff",
  ".aif",
  ".caf",
  ".webm",
];

const VOICE_NOTE_MIME_TYPES = [
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
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/aiff",
  "audio/x-aiff",
  "audio/x-caf",
  "audio/caf",
  "audio/webm",
];

export const VOICE_NOTE_EXTENSION_TO_MIME: Record<string, string> = {
  ogg: "audio/ogg",
  opus: "audio/opus",
  m4a: "audio/m4a",
  aac: "audio/aac",
  amr: "audio/amr",
  "3gp": "audio/3gpp",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  flac: "audio/flac",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  caf: "audio/x-caf",
  webm: "audio/webm",
};

const validateVoiceNoteFormat = (uri: string, mimeType?: string): boolean => {
  const lowerUri = uri.toLowerCase();
  const hasExt = VOICE_NOTE_EXTENSIONS.some((ext) => lowerUri.endsWith(ext));
  if (hasExt) return true;

  if (mimeType) {
    const lowerMime = mimeType.toLowerCase();
    return VOICE_NOTE_MIME_TYPES.some((m) => lowerMime.includes(m));
  }

  return false;
};

const validateFileSize = async (
  uri: string,
  maxSize: number,
): Promise<Result<boolean, EkweError>> => {
  try {
    const file = new ExpoFile(uri);

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

const sniffAudioHeader = async (uri: string): Promise<boolean> => {
  try {
    const file = new ExpoFile(uri);
    if (!file.exists) return false;
    const handle = file.open(FileMode.ReadOnly);
    const rawBytes = handle.readBytes(12);
    handle.close();

    const text = String.fromCharCode(...rawBytes);

    const signatures = [
      "OggS", // Ogg (Opus/Vorbis)
      "fLaC",
      "ID3", // MP3 with ID3 tag
      "RIFF", // WAV
      "ftyp", // MP4/M4A BMFF
      "caff", // Core Audio Format
      "FORM", // AIFF
      "#!AMR", // raw AMR-NB/WB
    ];

    if (signatures.some((sig) => text.includes(sig))) return true;

    // ADTS AAC syncword (0xFFF1/0xFFF9) and bare MP3 frame sync
    if (rawBytes[0] === 0xff && (rawBytes[1] & 0xe0) === 0xe0) return true;

    return false;
  } catch {
    return false;
  }
};

export const validateSharedAudio = async (
  uri: string,
  mimeType?: string,
): Promise<Result<{ uri: string }, EkweError>> => {
  if (uri.length === 0) return err(EkweError.SHARE_COPY_FAIL);

  const isGeneric = mimeType?.toLowerCase() === "application/octet-stream";

  if (!isGeneric && !validateVoiceNoteFormat(uri, mimeType)) {
    return err(EkweError.BAD_FORMAT);
  }

  const maxSize = auth$.isPro.peek()
    ? PREMIUM_LIMITS.maxAudioBytes
    : FREE_LIMITS.maxAudioBytes;

  const sizeResult = await validateFileSize(uri, maxSize);
  if (!sizeResult.ok) {
    return err(sizeResult.error);
  }

  const isSniffed = await sniffAudioHeader(uri);
  if (!isSniffed) {
    return err(EkweError.BAD_FORMAT);
  }

  return ok({ uri });
};
