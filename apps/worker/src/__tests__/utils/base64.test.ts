import { describe, expect, it } from "vitest";
import { bytesToBase64, base64ToBytes, blobToBase64 } from "@/utils/base64";

describe("base64 utils", () => {
  it("round-trips small data correctly", () => {
    const data = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const b64 = bytesToBase64(data);
    const decoded = base64ToBytes(b64);
    expect(decoded).toEqual(data);
  });

  it("handles empty input", () => {
    const data = new Uint8Array(0);
    const b64 = bytesToBase64(data);
    expect(b64).toBe("");
    const decoded = base64ToBytes(b64);
    expect(decoded).toEqual(data);
  });

  it("round-trips large data (tests chunking)", () => {
    const size = 100 * 1024;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }

    const b64 = bytesToBase64(data);
    const decoded = base64ToBytes(b64);
    expect(decoded).toEqual(data);
  });

  it("matches bytesToBase64 across chunk boundaries", async () => {
    for (const size of [32765, 32766, 32767, 65532, 65533, 100_000]) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = (i * 31) % 256;
      expect(await blobToBase64(new Blob([data]))).toBe(bytesToBase64(data));
    }
  });
});

describe("blobToBase64", () => {
  it("round-trips a blob larger than one chunk", async () => {
    const size = 100 * 1024;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 17) % 256;
    const decoded = base64ToBytes(await blobToBase64(new Blob([data])));
    expect(decoded).toEqual(data);
  });

  it("round-trips an empty blob", async () => {
    expect(await blobToBase64(new Blob([]))).toBe("");
  });
});
