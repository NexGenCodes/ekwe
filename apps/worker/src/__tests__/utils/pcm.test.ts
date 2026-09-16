import { describe, expect, it } from "vitest";
import { mergePcmFrames } from "@/utils/pcm";

describe("mergePcmFrames", () => {
  it("returns empty array for empty input", () => {
    const merged = mergePcmFrames([]);
    expect(merged.length).toBe(0);
  });

  it("returns same array for single input", () => {
    const frame = new Int16Array([1, 2, 3]);
    const merged = mergePcmFrames([frame]);
    expect(merged).toBe(frame);
  });

  it("merges multiple frames in order", () => {
    const frame1 = new Int16Array([1, 2]);
    const frame2 = new Int16Array([3, 4, 5]);
    const frame3 = new Int16Array([6]);

    const merged = mergePcmFrames([frame1, frame2, frame3]);
    expect(merged).toEqual(new Int16Array([1, 2, 3, 4, 5, 6]));
  });
});
