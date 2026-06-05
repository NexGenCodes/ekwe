import { AudioProcessor } from "../AudioProcessor";

import { EkweError } from "@/constants/errors";

jest.mock("expo-file-system", () => {
  return {
    File: jest.fn().mockImplementation((uri) => ({
      exists: true,
      size: 1000,
      uri,
    })),
  };
});

describe("AudioProcessor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("processRecording", () => {
    it("returns AUDIO_EMPTY if uri is empty", async () => {
      const result = await AudioProcessor.processRecording("", 1000, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(EkweError.AUDIO_EMPTY);
      }
    });

    it("returns TOO_SHORT if duration is < 500ms and > 0", async () => {
      const result = await AudioProcessor.processRecording(
        "file://test.m4a",
        400,
        [],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(EkweError.TOO_SHORT);
      }
    });

    it("computes averageDb from metering data", async () => {
      const uri = "file://test.m4a";
      const result = await AudioProcessor.processRecording(
        uri,
        1000,
        [-10, -20],
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe(uri);
        expect(result.value.averageDb).toBe(-15);
        expect(result.value.durationMs).toBe(1000);
      }
    });

    it("defaults averageDb to -160 when no metering data", async () => {
      const uri = "file://test.m4a";
      const result = await AudioProcessor.processRecording(uri, 1000, []);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe(uri);
        expect(result.value.averageDb).toBe(-160);
      }
    });
  });

  describe("validateSharedFile", () => {
    it("returns SHARE_COPY_FAIL if uri is empty", async () => {
      const result = await AudioProcessor.validateSharedFile("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(EkweError.SHARE_COPY_FAIL);
      }
    });
  });
});
