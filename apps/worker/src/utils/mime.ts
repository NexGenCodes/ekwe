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

  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
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
