import { AudioProcessor } from "../AudioProcessor";
import { EkweError } from "@/constants/errors";

describe("AudioProcessor.processRecording", () => {
  test("returns the processed audio for a valid recording", async () => {
    const result = await AudioProcessor.processRecording(
      "file:///recording.flac",
      5000,
      [-20, -30, -10],
      [0.1, 0.5, 0.9],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        uri: "file:///recording.flac",
        durationMs: 5000,
        meteringData: [-20, -30, -10],
        waveform: [0.1, 0.5, 0.9],
      });
      expect(result.value.averageDb).toBeCloseTo(-20);
    }
  });

  test("rejects recordings shorter than the 500ms floor", async () => {
    const result = await AudioProcessor.processRecording(
      "file:///a.flac",
      499,
      [],
    );
    expect(result).toEqual({ ok: false, error: EkweError.TOO_SHORT });
  });

  test("rejects an empty uri as an empty capture", async () => {
    const result = await AudioProcessor.processRecording("", 5000, []);
    expect(result).toEqual({ ok: false, error: EkweError.AUDIO_EMPTY });
  });

  test("uses the -160 floor when no metering data exists", async () => {
    const result = await AudioProcessor.processRecording(
      "file:///a.flac",
      2000,
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.averageDb).toBe(-160);
      expect(result.value.waveform).toEqual([]);
    }
  });

  test("computes the average across the metering window", async () => {
    const result = await AudioProcessor.processRecording(
      "file:///a.flac",
      2000,
      [-10, 0, 10],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.averageDb).toBeCloseTo(0);
    }
  });
});
