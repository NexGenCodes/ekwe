import {
  AudioModule,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
} from "expo-audio";
import { Paths } from "expo-file-system";

import AudioService from "@/services/AudioService";
import { releaseAudioEffects } from "@/utils/AudioEffectsModule";

jest.mock("expo-audio", () => {
  const mockRecorder = {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(function () {
      this.isRecording = true;
    }),
    stop: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    getStatus: jest.fn().mockReturnValue({
      durationMillis: 5000,
      metering: -20,
    }),
    isRecording: false,
    uri: "file://rec_test.m4a",
  };

  return {
    AudioModule: {
      AudioRecorder: jest.fn().mockImplementation(() => mockRecorder),
    },
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    requestRecordingPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ status: "granted" }),
    getRecordingPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ status: "granted" }),
    setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    AudioQuality: {
      MAX: "max",
      MIN: "min",
      LOW: "low",
      HIGH: "high",
    },
    IOSOutputFormat: {
      MPEG4AAC: "aac",
      LINEARPCM: "lpcm",
    },
  };
});

jest.mock("expo-file-system", () => ({
  Paths: {
    cache: {
      list: jest.fn().mockReturnValue([]),
    },
  },
}));

jest.mock("@/utils/AudioEffectsModule", () => ({
  releaseAudioEffects: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/utils/haptics", () => ({
  triggerHaptic: jest.fn(),
}));

jest.mock("@/utils", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  isIOS: true,
}));

beforeEach(async () => {
  jest.clearAllMocks();
  // Reset internal AudioService state between tests
  await AudioService.cleanup().catch(() => {});
});

describe("AudioService", () => {
  describe("checkPermission", () => {
    it("returns granted when permission is granted", async () => {
      (getRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: "granted",
      });

      const result = await AudioService.checkPermission();

      expect(result).toBe("granted");
    });

    it("returns denied when permission is denied", async () => {
      (getRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: "denied",
      });

      const result = await AudioService.checkPermission();

      expect(result).toBe("denied");
    });

    it("returns undetermined when permission is undetermined", async () => {
      (getRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: "undetermined",
      });

      const result = await AudioService.checkPermission();

      expect(result).toBe("undetermined");
    });
  });

  describe("requestPermission", () => {
    it("requests and returns permission status", async () => {
      (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: "granted",
      });

      const result = await AudioService.requestPermission();

      expect(result).toBe("granted");
      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
    });
  });

  describe("startRecording", () => {
    it("sets audio mode and creates recorder", async () => {
      await AudioService.startRecording();

      expect(setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });
      // eslint-disable-next-line import/namespace
      expect(AudioModule.AudioRecorder).toHaveBeenCalled();
    });

    it("throws when recorder creation fails", async () => {
      const failRecorder = {
        prepareToRecordAsync: jest
          .fn()
          .mockRejectedValue(new Error("prepare failed")),
      };
      // eslint-disable-next-line import/namespace
      (AudioModule.AudioRecorder as jest.Mock).mockImplementationOnce(
        () => failRecorder,
      );

      await expect(AudioService.startRecording()).rejects.toThrow(
        "prepare failed",
      );
    });
  });

  describe("stopRecording", () => {
    it("stops recording and returns path and duration", async () => {
      await AudioService.startRecording();
      const result = await AudioService.stopRecording();

      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("duration");
      expect(releaseAudioEffects).toHaveBeenCalled();
    });

    it("throws if no recorder initialized", async () => {
      await AudioService.cleanup();

      await expect(AudioService.stopRecording()).rejects.toThrow(
        "Recorder not initialized",
      );
    });
  });

  describe("getMetering", () => {
    it("returns metering value when recording", async () => {
      await AudioService.startRecording();

      const metering = AudioService.getMetering();

      expect(metering).toBe(-20);
    });

    it("returns -160 when not recording", async () => {
      await AudioService.cleanup();

      const metering = AudioService.getMetering();

      expect(metering).toBe(-160);
    });
  });

  describe("isRecording", () => {
    it("returns false initially", async () => {
      await AudioService.cleanup();

      expect(AudioService.isRecording()).toBe(false);
    });
  });

  describe("setPlaybackMode", () => {
    it("exists and is callable", async () => {
      await expect(AudioService.setPlaybackMode()).resolves.toBeUndefined();
    });
  });

  describe("purgeCache", () => {
    it("does nothing when cache has no audio files", async () => {
      (Paths.cache.list as jest.Mock).mockReturnValueOnce([
        { name: "some.txt", exists: true, delete: jest.fn() },
      ]);

      await AudioService.purgeCache();
    });

    it("does not throw when called with audio files in cache", async () => {
      const deleteMock = jest.fn();
      (Paths.cache.list as jest.Mock).mockReturnValueOnce([
        {
          name: "rec_123.m4a",
          exists: true,
          delete: deleteMock,
        },
      ]);

      await expect(AudioService.purgeCache()).resolves.not.toThrow();
    });

    it("handles errors gracefully", async () => {
      (Paths.cache.list as jest.Mock).mockImplementationOnce(() => {
        throw new Error("disk error");
      });

      await expect(AudioService.purgeCache()).resolves.not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("stops and releases the recorder", async () => {
      await AudioService.startRecording();
      await AudioService.cleanup();

      expect(releaseAudioEffects).toHaveBeenCalled();
      expect(AudioService.isRecording()).toBe(false);
    });
  });
});
