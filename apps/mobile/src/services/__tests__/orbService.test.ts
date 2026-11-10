import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrbService } from "@/services/orbService";
import { EkweError } from "@/constants/errors";

const { mockEkweNative, mockAuthState, mockSettingsState } = vi.hoisted(() => ({
  mockEkweNative: {
    checkOverlayPermission: vi.fn(),
    requestOverlayPermission: vi.fn(),
    getOrbStatus: vi.fn(),
    configureOrb: vi.fn(),
    startOrbCapture: vi.fn(),
    stopOrbCapture: vi.fn(),
  },
  mockAuthState: {
    session: { user: { id: "user-1" } },
    isPro: true,
  },
  mockSettingsState: {
    orbSourceLang: "auto",
  },
}));

vi.mock("@/utils/platform", () => ({
  isAndroid: true,
  isIOS: false,
}));

vi.mock("../../../modules/ekwe-native", () => ({
  default: mockEkweNative,
}));

vi.mock("@/store", () => ({
  auth$: {
    session: { peek: () => mockAuthState.session },
    isPro: { peek: () => mockAuthState.isPro },
  },
  settings$: {
    orbSourceLang: { peek: () => mockSettingsState.orbSourceLang },
  },
}));

vi.mock("@/services/backend", () => ({
  ensureAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn().mockReturnValue("https://example.test"),
}));

vi.mock("expo-file-system", () => {
  class MockFile {
    exists = true;
    size = 2048;
    constructor(public uri: string) {}
  }
  return {
    File: MockFile,
    Paths: {
      cache: { uri: "file:///mock/cache/" },
    },
  };
});

vi.mock("@/services/transcribeAudio", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      transcript: "Bonjour le monde",
      detectedLang: "fr",
      sourceLang: "fr",
      durationSeconds: 3,
      isLowQuality: false,
      provider: "groq",
    },
  }),
}));

vi.mock("@/services/historyService", () => ({
  HistoryService: {
    recordTranslation: vi.fn().mockResolvedValue("mock-history-id-123"),
  },
}));

describe("OrbService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.session = { user: { id: "user-1" } };
    mockAuthState.isPro = true;
  });

  describe("permission & status checks", () => {
    it("checks overlay permission", async () => {
      mockEkweNative.checkOverlayPermission.mockResolvedValue(true);
      const res = await OrbService.checkOverlayPermission();
      expect(res).toBe(true);
      expect(mockEkweNative.checkOverlayPermission).toHaveBeenCalled();
    });

    it("requests overlay permission", async () => {
      mockEkweNative.requestOverlayPermission.mockResolvedValue(true);
      const res = await OrbService.requestOverlayPermission();
      expect(res).toBe(true);
      expect(mockEkweNative.requestOverlayPermission).toHaveBeenCalled();
    });

    it("returns orb status", async () => {
      const status = {
        running: true,
        hasMediaProjection: true,
        foregroundApp: "com.whatsapp",
        lastPeakAmplitude: 0.8,
        canDrawOverlays: true,
      };
      mockEkweNative.getOrbStatus.mockResolvedValue(status);
      const res = await OrbService.getStatus();
      expect(res).toEqual(status);
    });

    it("configures orb", async () => {
      mockEkweNative.configureOrb.mockResolvedValue(true);
      const res = await OrbService.configure({ orbEnabled: true });
      expect(res).toBe(true);
      expect(mockEkweNative.configureOrb).toHaveBeenCalledWith({
        orbEnabled: true,
      });
    });
  });

  describe("startCapture", () => {
    it("starts capture session successfully", async () => {
      mockEkweNative.startOrbCapture.mockResolvedValue({
        success: true,
        error: "",
      });
      const res = await OrbService.startCapture({ isLive: false });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.captureId).toMatch(/^orb_/);
        expect(res.value.outputPath).toContain("file:///mock/cache/ekwe_orb_");
        expect(mockEkweNative.startOrbCapture).toHaveBeenCalledWith(
          res.value.outputPath,
          false,
          undefined,
        );
      }
    });

    it("returns error when native capture start fails", async () => {
      mockEkweNative.startOrbCapture.mockResolvedValue({
        success: false,
        error: "Consent rejected",
      });
      const res = await OrbService.startCapture({ isLive: false });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe(EkweError.AUDIO_RECORD_FAIL);
      }
    });
  });

  describe("stopCapture", () => {
    it("stops capture, transcribes, and writes to history with origin orb", async () => {
      mockEkweNative.stopOrbCapture.mockResolvedValue({
        success: true,
        error: "",
      });
      mockEkweNative.getOrbStatus.mockResolvedValue({
        running: false,
        hasMediaProjection: false,
        foregroundApp: "com.whatsapp",
        lastPeakAmplitude: 0.5,
      });

      const session = {
        captureId: "test-orb-123",
        outputPath: "file:///mock/cache/test.ogg",
        startTime: Date.now() - 2500, // 2.5s ago
      };

      const res = await OrbService.stopCapture(session, {
        sourceLang: "fr",
        targetLang: "en",
        sessionUser: { user: { id: "user-abc" } },
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.transcript).toBe("Bonjour le monde");
        expect(res.value.historyId).toBe("mock-history-id-123");
      }
    });
  });
});
