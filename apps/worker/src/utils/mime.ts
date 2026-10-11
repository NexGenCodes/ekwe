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
