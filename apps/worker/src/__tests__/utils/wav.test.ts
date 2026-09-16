import { describe, expect, it } from "vitest";
import { pcmToWav } from "@/utils/wav";

describe("pcmToWav", () => {
  it("wraps PCM in a valid WAV container", () => {
    const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
    const sampleRate = 16000;

    const wav = pcmToWav(pcm, sampleRate);

    // Output size = 44 + PCM byte length
    expect(wav.byteLength).toBe(44 + pcm.byteLength);

    // Check RIFF header
    const dv = new DataView(wav.buffer);
    const textDecoder = new TextDecoder();

    const riff = textDecoder.decode(wav.subarray(0, 4));
    expect(riff).toBe("RIFF");

    const wave = textDecoder.decode(wav.subarray(8, 12));
    expect(wave).toBe("WAVE");

    const fmt = textDecoder.decode(wav.subarray(12, 16));
    expect(fmt).toBe("fmt ");

    const data = textDecoder.decode(wav.subarray(36, 40));
    expect(data).toBe("data");

    // Check sample rate is written correctly
    expect(dv.getUint32(24, true)).toBe(sampleRate);
  });
});
