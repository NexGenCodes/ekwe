import type { AudioCodec } from "@ekwe/shared/providerLimits";

const EXT_MAP: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpeg3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ulaw": "ulaw",
  "audio/raw": "raw",
  "audio/amr": "amr",
  "audio/amr-wb": "amr",
  "audio/3gpp": "3gp",
  "audio/3gpp2": "3gpp2",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/x-caf": "caf",
};

export function mimeToExt(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT_MAP[base] ?? "wav";
}

/**
 * Enough prefix to separate codecs inside a shared container. Ogg names the
 * codec in the second packet's identification header; Matroska's CodecID is an
 * EBML element rather than a fixed offset.
 */
export const CODEC_SNIFF_BYTES = 64;

export interface SniffedFormat {
  /** Container MIME, as re-typed onto the blob for providers that trust it. */
  readonly mime: string;
  readonly codec: AudioCodec;
}

/**
 * Resolves the codec, not just the container. `audio/ogg` covers both Vorbis
 * and Opus, and Wit parses only the former — answering the latter with silence
 * rather than an error, which is a silent wrong answer rather than a visible
 * failure.
 */
export function sniffAudioFormat(
  bytes: Uint8Array,
  declared: string,
): SniffedFormat {
  const mime = sniffAudioMime(bytes, declared);

  if (bytes.length < 4) return { mime, codec: "unknown" };

  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];

  // Ogg: the identification packet names the codec in plain ASCII.
  if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) {
    const head = latin1(bytes, CODEC_SNIFF_BYTES);
    if (head.includes("OpusHead")) return { mime, codec: "opus" };
    if (head.includes("vorbis")) return { mime, codec: "vorbis" };
    return { mime, codec: "unknown" };
  }

  // Matroska/WebM: CodecID lives in the Track entry, beyond the EBML header.
  if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
    const head = latin1(bytes, CODEC_SNIFF_BYTES);
    if (head.includes("A_OPUS")) return { mime, codec: "opus" };
    if (head.includes("A_VORBIS")) return { mime, codec: "vorbis" };
    return { mime, codec: "webm" };
  }

  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    return { mime, codec: "wav" };
  }
  if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) {
    return { mime, codec: "flac" };
  }
  if (b0 === 0x23 && b1 === 0x21 && b2 === 0x41 && b3 === 0x4d) {
    return { mime, codec: "amr" };
  }
  if (b0 === 0x46 && b1 === 0x4f && b2 === 0x52 && b3 === 0x4d) {
    return { mime, codec: "aiff" };
  }
  if (b0 === 0x63 && b1 === 0x61 && b2 === 0x66 && b3 === 0x66) {
    return { mime, codec: "caf" };
  }
  if (bytes.length >= 8 && latin1(bytes, 4) === "ftyp") {
    const brand = latin1(bytes, 12).slice(4, 8);
    return { mime, codec: brand === "M4A " ? "m4a" : "m4a" };
  }
  // ID3 prefix, or the ADTS/MPEG sync word. Layer bits separate them:
  // 00 is AAC, 01 is MPEG audio.
  if (bytes.length >= 3 && b0 === 0x49 && b1 === 0x44 && b2 === 0x33) {
    return { mime, codec: "mp3" };
  }
  if (bytes.length >= 2 && b0 === 0xff && (b1 & 0xe0) === 0xe0) {
    return { mime, codec: (b1 & 0x06) === 0 ? "aac" : "mp3" };
  }

  return { mime, codec: "unknown" };
}

function latin1(bytes: Uint8Array, length: number): string {
  const end = Math.min(bytes.length, length);
  let out = "";
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function sniffAudioMime(bytes: Uint8Array, declared: string): string {
  const base = declared.split(";")[0].trim().toLowerCase();

  if (bytes.length >= 4) {
    const b = bytes;
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)
      return "audio/ogg";
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46)
      return "audio/wav";
    if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43)
      return "audio/flac";
    // #!AMR raw narrowband / wideband
    if (b[0] === 0x23 && b[1] === 0x21 && b[2] === 0x41 && b[3] === 0x4d)
      return "audio/amr";
    // FORM....AIFF
    if (b[0] === 0x46 && b[1] === 0x4f && b[2] === 0x52 && b[3] === 0x4d) {
      if (
        bytes[8] === 0x41 &&
        bytes[9] === 0x49 &&
        bytes[10] === 0x46 &&
        bytes[11] === 0x46
      )
        return "audio/aiff";
    }
    // CAF (caff)
    if (b[0] === 0x63 && b[1] === 0x61 && b[2] === 0x66 && b[3] === 0x66)
      return "audio/x-caf";
  }

  // EBML/WebM container
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "audio/webm";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    return "audio/mpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "audio/mp4";
  }

  // 0xFFEx sync word: ADTS AAC (layer bits 00) vs MP3 frame (layer bits 01).
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }

  if (
    base &&
    base !== "application/octet-stream" &&
    base.startsWith("audio/")
  ) {
    return base;
  }
  return "audio/wav";
}
