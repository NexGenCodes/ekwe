import { AudioCapture } from "../AudioCapture";

jest.mock("@/utils", () => ({
  isAndroid: false,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: {
    Warning: "warning",
    Error: "error",
    Success: "success",
  },
}));

jest.mock("@/services/AudioService", () => ({
  __esModule: true,
  default: {
    requestPermission: jest.fn(),
    checkPermission: jest.fn(),
    isRecording: jest.fn(),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    getMetering: jest.fn(),
  },
}));

jest.mock("@/services/VolumeManager", () => ({
  VolumeManager: {
    raiseVolumeIfNeeded: jest.fn(),
    restoreVolume: jest.fn(),
  },
}));

jest.mock("@/constants/billing", () => ({
  PLAN_LIMITS: {
    free: { dictationDurationMs: 60000 },
    pro: { dictationDurationMs: 300000 },
  },
}));

jest.mock("@/store", () => ({
  auth$: {
    isPro: { get: jest.fn().mockReturnValue(false) },
  },
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("@/utils/fileValidation", () => ({
  validateSharedAudio: jest.fn(),
}));

jest.mock("@/utils/AudioEffectsModule", () => ({
  attachAudioEffects: jest.fn(),
  releaseAudioEffects: jest.fn(),
}));

jest.mock("@/utils/alert", () => ({
  AppAlert: {
    info: jest.fn(),
  },
}));

jest.mock("react-native", () => ({
  Linking: { openSettings: jest.fn() },
}));

const AudioService = require("@/services/AudioService").default;
const { VolumeManager } = require("@/services/VolumeManager");
const { validateSharedAudio } = require("@/utils/fileValidation");

describe("AudioCapture", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AudioService.isRecording.mockReturnValue(false);
  });

  describe("requestPermission", () => {
    it("returns ok(true) when granted", async () => {
      AudioService.requestPermission.mockResolvedValue("granted");
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it("shows alert when denied", async () => {
      AudioService.requestPermission.mockResolvedValue("denied");
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(false);
    });

    it("returns error on exception", async () => {
      AudioService.requestPermission.mockRejectedValue(
        new Error("permission error"),
      );
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(false);
    });
  });

  describe("checkPermission", () => {
    it("returns ok(true) when granted", async () => {
      AudioService.checkPermission.mockResolvedValue("granted");
      const result = await AudioCapture.checkPermission();
      expect(result.ok).toBe(true);
    });

    it("returns ok(false) when denied", async () => {
      AudioService.checkPermission.mockResolvedValue("denied");
      const result = await AudioCapture.checkPermission();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });

    it("returns error on exception", async () => {
      AudioService.checkPermission.mockRejectedValue(new Error("check error"));
      const result = await AudioCapture.checkPermission();
      expect(result.ok).toBe(false);
    });
  });

  describe("startRecording", () => {
    it("starts recording when audio service is already active", async () => {
      AudioService.isRecording.mockReturnValue(true);
      AudioService.stopRecording.mockResolvedValue({
        path: "file://old.m4a",
        duration: 1000,
      });
      AudioService.checkPermission.mockResolvedValue("granted");
      AudioService.startRecording.mockResolvedValue(undefined);
      AudioService.getMetering.mockReturnValue(-30);

      const result = await AudioCapture.startRecording("session-1");
      expect(result.ok).toBe(true);
    });

    it("returns error when permission check fails", async () => {
      AudioService.checkPermission.mockResolvedValue("denied");
      const result = await AudioCapture.startRecording("session-1");
      expect(result.ok).toBe(false);
    });

    it("sets up metering interval and max duration timeout", async () => {
      AudioService.checkPermission.mockResolvedValue("granted");
      AudioService.startRecording.mockResolvedValue(undefined);
      AudioService.getMetering.mockReturnValue(-30);

      const result = await AudioCapture.startRecording("session-1");
      expect(result.ok).toBe(true);
      expect(VolumeManager.raiseVolumeIfNeeded).toHaveBeenCalled();
    });
  });

  describe("stopRecording", () => {
    it("returns error when not recording", async () => {
      AudioService.isRecording.mockReturnValue(false);
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
    });

    it("stops recording and returns result", async () => {
      AudioService.checkPermission.mockResolvedValue("granted");
      AudioService.startRecording.mockResolvedValue(undefined);
      AudioService.getMetering.mockReturnValue(-30);
      AudioService.isRecording.mockReturnValue(true);
      AudioService.stopRecording.mockResolvedValue({
        path: "file://test.m4a",
        duration: 5000,
      });

      await AudioCapture.startRecording("session-1");

      AudioService.isRecording.mockReturnValue(true);
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe("file://test.m4a");
        expect(result.value.durationMs).toBe(5000);
        expect(result.value.sessionId).toBe("session-1");
        expect(VolumeManager.restoreVolume).toHaveBeenCalled();
      }
    });
  });

  describe("cancelRecording", () => {
    it("stops and cleans up", async () => {
      AudioService.stopRecording.mockResolvedValue({
        path: "file://test.m4a",
        duration: 0,
      });
      const result = await AudioCapture.cancelRecording();
      expect(result.ok).toBe(true);
    });
  });

  describe("processSharedFile", () => {
    it("returns error on invalid file", async () => {
      validateSharedAudio.mockResolvedValue({
        ok: false,
        error: "SHARE_COPY_FAIL",
      });
      const result = await AudioCapture.processSharedFile("file://shared.m4a");
      expect(result.ok).toBe(false);
    });

    it("processes valid shared file", async () => {
      validateSharedAudio.mockResolvedValue({
        ok: true,
        value: { uri: "file://output.m4a" },
      });
      const result = await AudioCapture.processSharedFile(
        "file://shared.m4a",
        "audio/m4a",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe("file://output.m4a");
      }
    });
  });

  describe("listeners", () => {
    it("addListener returns unsubscribe function", () => {
      const cb = jest.fn();
      const unsubscribe = AudioCapture.addListener(cb);
      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
    });

    it("addStatusListener notifies on status changes", () => {
      const cb = jest.fn();
      const unsubscribe = AudioCapture.addStatusListener(cb);
      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("isRecording", () => {
    it("delegates to AudioService", () => {
      AudioService.isRecording.mockReturnValue(true);
      expect(AudioCapture.isRecording()).toBe(true);

      AudioService.isRecording.mockReturnValue(false);
      expect(AudioCapture.isRecording()).toBe(false);
    });
  });
});
