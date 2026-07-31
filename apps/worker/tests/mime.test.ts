import { describe, test, expect } from "vitest";
import { mimeToExt, sniffAudioMime } from "../src/utils/mime";

describe("mimeToExt", () => {
  test("maps known audio MIME types", () => {
    expect(mimeToExt("audio/ogg")).toBe("ogg");
    expect(mimeToExt("audio/mpeg")).toBe("mp3");
    expect(mimeToExt("audio/mp4")).toBe("m4a");
    expect(mimeToExt("audio/flac")).toBe("flac");
    expect(mimeToExt("audio/wav")).toBe("wav");
    expect(mimeToExt("audio/aac")).toBe("aac");
  });

  test("falls back to wav for unknown types", () => {
    expect(mimeToExt("application/octet-stream")).toBe("wav");
    expect(mimeToExt("")).toBe("wav");
  });
});

describe("sniffAudioMime", () => {
  function header(bytes: number[]): Uint8Array {
    return new Uint8Array(bytes);
  }

  test("detects OGG from magic bytes", () => {
    const ogg = header([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
    expect(sniffAudioMime(ogg, "application/octet-stream")).toBe("audio/ogg");
  });

  test("detects WAV from RIFF header", () => {
    const wav = header([0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00]);
    expect(sniffAudioMime(wav, "")).toBe("audio/wav");
  });

  test("detects FLAC from magic bytes", () => {
    const flac = header([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
    expect(sniffAudioMime(flac, "application/octet-stream")).toBe(
      "audio/flac",
    );
  });

  test("detects MP3 from ID3 tag", () => {
    const mp3 = header([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffAudioMime(mp3, "")).toBe("audio/mpeg");
  });

  test("detects MP3 from frame sync", () => {
    const mp3 = header([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffAudioMime(mp3, "application/octet-stream")).toBe("audio/mpeg");
  });

  test("detects M4A from ftyp box", () => {
    const m4a = header([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41,
      0x20,
    ]);
    expect(sniffAudioMime(m4a, "application/octet-stream")).toBe("audio/mp4");
  });

  test("honors a declared audio type when magic bytes are unknown", () => {
    const bytes = header([0x00, 0x01, 0x02, 0x03]);
    expect(sniffAudioMime(bytes, "audio/ogg")).toBe("audio/ogg");
  });

  test("defaults to wav for unknown data without a declared type", () => {
    const bytes = header([0x00, 0x01, 0x02, 0x03]);
    expect(sniffAudioMime(bytes, "application/octet-stream")).toBe(
      "audio/wav",
    );
    expect(sniffAudioMime(bytes, "")).toBe("audio/wav");
  });

  test("does not treat short/non-audio data as MP3 frame sync", () => {
    expect(sniffAudioMime(header([0xff]), "")).toBe("audio/wav");
    expect(sniffAudioMime(header([0xff, 0x7f]), "")).toBe("audio/wav");
  });
});
