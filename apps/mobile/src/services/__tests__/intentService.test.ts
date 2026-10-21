import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntentService } from "@/services/intentService";

const native = vi.hoisted(() => ({
  resolveAndTranscodeToOpus: vi.fn(),
  resolveContentUri: vi.fn(),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../../../modules/ekwe-native", () => ({ default: native }));
vi.mock("@/utils", () => ({ isAndroid: true }));
vi.mock("@/utils/logger", () => ({ default: logger }));
vi.mock("@ekwe/shared/plans", () => ({ MAX_AUDIO_BYTES: 5_000_000 }));

const OK = {
  success: true,
  error: "",
  durationMs: 1000,
  waveform: [0.1],
  playbackUri: "",
};

const ARGS_MISMATCH =
  'java.lang.NoSuchMethodError: no non-static method "Lexpo/modules/kotlin/exception/InvalidArgsNumberException;.<init>(III)V"';

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntentService.resolveAndTranscodeToOpus", () => {
  it("calls the 3-argument signature when no duration limit is supplied", async () => {
    native.resolveAndTranscodeToOpus.mockResolvedValue(OK);

    await expect(
      IntentService.resolveAndTranscodeToOpus("content://audio", "/out.ogg"),
    ).resolves.toEqual(OK);

    expect(native.resolveAndTranscodeToOpus).toHaveBeenCalledWith(
      "content://audio",
      "/out.ogg",
      5_000_000,
    );
  });

  it("passes the duration limit to the current 4-argument signature", async () => {
    native.resolveAndTranscodeToOpus.mockResolvedValue(OK);

    await expect(
      IntentService.resolveAndTranscodeToOpus("content://audio", "/out.ogg", {
        maxDurationMs: 60_000,
      }),
    ).resolves.toEqual(OK);

    expect(native.resolveAndTranscodeToOpus).toHaveBeenCalledWith(
      "content://audio",
      "/out.ogg",
      5_000_000,
      { maxDurationMs: 60_000 },
    );
  });

  it("retries the legacy signature when the binary predates options", async () => {
    native.resolveAndTranscodeToOpus
      .mockRejectedValueOnce(new Error(ARGS_MISMATCH))
      .mockResolvedValueOnce(OK);

    await expect(
      IntentService.resolveAndTranscodeToOpus("content://audio", "/out.ogg", {
        maxDurationMs: 60_000,
      }),
    ).resolves.toEqual(OK);

    expect(native.resolveAndTranscodeToOpus).toHaveBeenNthCalledWith(
      1,
      "content://audio",
      "/out.ogg",
      5_000_000,
      { maxDurationMs: 60_000 },
    );
    expect(native.resolveAndTranscodeToOpus).toHaveBeenNthCalledWith(
      2,
      "content://audio",
      "/out.ogg",
      5_000_000,
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("enforces the plan limit when the legacy signature ignores it", async () => {
    native.resolveAndTranscodeToOpus
      .mockRejectedValueOnce(new Error(ARGS_MISMATCH))
      .mockResolvedValueOnce({ ...OK, durationMs: 61_000 });

    await expect(
      IntentService.resolveAndTranscodeToOpus("content://audio", "/out.ogg", {
        maxDurationMs: 60_000,
      }),
    ).resolves.toEqual({
      ...OK,
      durationMs: 61_000,
      success: false,
      error: "AUDIO_TOO_LONG",
      waveform: [],
    });
  });

  it("does not retry unrelated native failures", async () => {
    native.resolveAndTranscodeToOpus.mockRejectedValueOnce(
      new Error("decode exploded"),
    );

    await expect(
      IntentService.resolveAndTranscodeToOpus("content://audio", "/out.ogg", {
        maxDurationMs: 60_000,
      }),
    ).resolves.toBeNull();

    expect(native.resolveAndTranscodeToOpus).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
