import { describe, expect, it } from "vitest";
import { bytesToBase64, base64ToBytes } from "@/utils/base64";

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
});
