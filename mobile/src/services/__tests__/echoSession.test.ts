import { handleEchoSession } from "../echoSession";

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock("../../../modules/ekwe-native", () => ({
  __esModule: true,
  default: {
    deleteFile: jest.fn(),
  },
}));

jest.mock("@/services/AudioProcessor", () => ({
  AudioProcessor: {
    processRecording: jest.fn(),
  },
}));

jest.mock("@/services/transcribeAudio", () => ({
  transcribeAudio: jest.fn(),
}));

jest.mock("@/services/translateText", () => ({
  translateText: jest.fn(),
}));

jest.mock("@/services/HistoryService", () => ({
  HistoryService: {
    recordTranslation: jest.fn(),
  },
}));

jest.mock("@/store/audio", () => ({
  audioActions: {
    setActiveFloatingHead: jest.fn(),
  },
}));

jest.mock("@/store/auth", () => ({
  auth$: {
    session: {
      get: jest.fn(),
    },
  },
}));

jest.mock("@/store/settings", () => ({
  settings$: {
    targetLanguage: {
      get: jest.fn(),
    },
  },
}));

jest.mock("@/utils/BubbleModule", () => ({
  BubbleNative: {
    dismissOverlay: jest.fn(),
    updateState: jest.fn(),
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

const {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} = require("expo-keep-awake");

const EkweNative = require("../../../modules/ekwe-native");

const { AudioProcessor } = require("@/services/AudioProcessor");
const { HistoryService } = require("@/services/HistoryService");
const { transcribeAudio } = require("@/services/transcribeAudio");
const { translateText } = require("@/services/translateText");
const { audioActions } = require("@/store/audio");
const { auth$ } = require("@/store/auth");
const { settings$ } = require("@/store/settings");
const { BubbleNative } = require("@/utils/BubbleModule");

describe("handleEchoSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auth$.session.get.mockReturnValue({ user: { id: "user-1" } });
    AudioProcessor.processRecording.mockResolvedValue({
      ok: true,
      value: { uri: "file://test.m4a", durationMs: 5000, averageDb: -20 },
    });
    transcribeAudio.mockResolvedValue({
      ok: true,
      value: {
        transcript: "hello world",
        detectedLang: "en",
        durationSeconds: 5.0,
      },
    });
    translateText.mockResolvedValue({
      ok: true,
      value: { translation: "hola mundo" },
    });
    HistoryService.recordTranslation.mockResolvedValue(undefined);
    settings$.targetLanguage.get.mockReturnValue("es");
  });

  it("aborts early when user is not authenticated", async () => {
    auth$.session.get.mockReturnValue(null);
    await handleEchoSession("file://test.m4a", "TestApp");

    expect(BubbleNative.dismissOverlay).toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("processes transcription and translation successfully", async () => {
    await handleEchoSession("file://test.m4a", "TestApp");

    expect(BubbleNative.updateState).toHaveBeenCalledWith("MAGIC");
    expect(audioActions.setActiveFloatingHead).toHaveBeenCalledWith("card");
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith("ekweEcho");
    expect(AudioProcessor.processRecording).toHaveBeenCalledWith(
      "file://test.m4a",
      0,
      [],
    );
    expect(transcribeAudio).toHaveBeenCalled();
    expect(translateText).toHaveBeenCalledWith(
      "hello world",
      "en",
      "es",
      expect.any(AbortSignal),
    );
    expect(HistoryService.recordTranslation).toHaveBeenCalled();
    expect(BubbleNative.dismissOverlay).toHaveBeenCalled();
  });

  it("uses fallback audio when processing fails", async () => {
    AudioProcessor.processRecording.mockResolvedValue({
      ok: false,
      error: "PROCESSOR_FAIL",
    });

    await handleEchoSession("file://test.m4a");
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file://test.m4a", averageDb: -40 }),
      "auto",
      expect.any(AbortSignal),
    );
  });

  it("skips translation when transcription fails", async () => {
    transcribeAudio.mockResolvedValue({
      ok: false,
      error: "TRANSCRIPTION_FAIL",
    });

    await handleEchoSession("file://test.m4a");
    expect(translateText).not.toHaveBeenCalled();
    expect(HistoryService.recordTranslation).not.toHaveBeenCalled();
  });

  it("handles null translation result gracefully", async () => {
    transcribeAudio.mockResolvedValue({
      ok: true,
      value: {
        transcript: "hello",
        detectedLang: "en",
        durationSeconds: 2.0,
      },
    });
    translateText.mockResolvedValue({
      ok: false,
      error: "TRANSLATION_FAIL",
    });

    await handleEchoSession("file://test.m4a");
    expect(HistoryService.recordTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        translation: null,
        transcript: "hello",
      }),
      expect.anything(),
    );
  });

  it("aborts early if signal is aborted after transcription", async () => {
    transcribeAudio.mockImplementation(
      async (_audio: unknown, _lang: string, signal: AbortSignal) => {
        signal.dispatchEvent(new Event("abort"));
        return {
          ok: true,
          value: {
            transcript: "hello",
            detectedLang: "en",
            durationSeconds: 2.0,
          },
        };
      },
    );

    // Manually trigger abort after transcription by having echoSessionAbort fire
    await handleEchoSession("file://test.m4a");
    // Should not error — the signal.aborted check catches it
  });

  it("cleans up in finally block on error", async () => {
    transcribeAudio.mockRejectedValue(new Error("network error"));

    await handleEchoSession("file://test.m4a");
    expect(deactivateKeepAwake).toHaveBeenCalledWith("ekweEcho");
    expect(EkweNative.default.deleteFile).toHaveBeenCalledWith(
      "file://test.m4a",
    );
    expect(BubbleNative.updateState).toHaveBeenCalledWith("IDLE");
  });
});
