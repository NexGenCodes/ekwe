import { describe, test, expect } from "vitest";
import { mergePcmFrames } from "../../src/utils/pcm";
import { pcmToWav } from "../../src/utils/wav";

function readStr(wav: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...Array.from(wav.slice(offset, offset + length)));
}

describe("mergePcmFrames", () => {
  test("returns an empty buffer for no frames", () => {
    expect(mergePcmFrames([]).length).toBe(0);
  });

  test("returns the frame itself for a single frame", () => {
    const frame = new Int16Array([1, 2, 3]);
    expect(mergePcmFrames([frame])).toBe(frame);
  });

  test("concatenates multiple frames in order", () => {
    const merged = mergePcmFrames([
      new Int16Array([1, 2]),
      new Int16Array([3, 4, 5]),
      new Int16Array([6]),
    ]);
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("pcmToWav", () => {
  test("builds a valid RIFF/WAVE container", () => {
    const pcm = new Int16Array([100, -100, 0, 42]);
    const wav = pcmToWav(pcm, 16000);
    const dv = new DataView(wav.buffer);

    expect(wav.length).toBe(44 + pcm.byteLength);
    expect(readStr(wav, 0, 4)).toBe("RIFF");
    expect(dv.getUint32(4, true)).toBe(wav.length - 8);
    expect(readStr(wav, 8, 4)).toBe("WAVE");
    expect(readStr(wav, 12, 4)).toBe("fmt ");
    expect(dv.getUint32(16, true)).toBe(16);
    expect(dv.getUint16(20, true)).toBe(1); // PCM format
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(16000); // sample rate
    expect(dv.getUint32(28, true)).toBe(32000); // byte rate = rate * ch * 2
    expect(dv.getUint16(32, true)).toBe(2); // block align
    expect(dv.getUint16(34, true)).toBe(16); // bits per sample
    expect(readStr(wav, 36, 4)).toBe("data");
    expect(dv.getUint32(40, true)).toBe(pcm.byteLength);

    const dataView = new DataView(wav.buffer, 44);
    expect(dataView.getInt16(0, true)).toBe(100);
    expect(dataView.getInt16(2, true)).toBe(-100);
  });

  test("copies from the pcm byteOffset correctly", () => {
    const full = new Int16Array([0, 0, 7, 8, 9]);
    const sub = full.subarray(2);
    const wav = pcmToWav(sub, 8000);

    expect(wav.length).toBe(44 + sub.byteLength);
    const dataView = new DataView(wav.buffer, 44);
    expect(dataView.getInt16(0, true)).toBe(7);
  });
});
