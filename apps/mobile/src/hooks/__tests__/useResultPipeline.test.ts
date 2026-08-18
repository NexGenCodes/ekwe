import { act, renderHook, waitFor } from "@testing-library/react-native";

import { useResultPipeline } from "../useResultPipeline";
import { history$ } from "@/store";

import { batchTranscriber } from "@/services/BatchTranscriber";
import { HistoryService } from "@/services/HistoryService";
import type { TranscriptionResult } from "@/services/transcribeAudio";
import { EkweError } from "@/constants/errors";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";

jest.mock("@/hooks/queries/useUsageQuery", () => ({
  invalidateUsage: jest.fn(),
  useUsageQuery: jest.fn(() => ({ data: undefined, isFetching: false })),
  usageQueryKey: ["usage"],
}));

const mockTranslate = jest.fn();
jest.mock("../useTranslation", () => ({
  useTranslation: () => ({ translate: mockTranslate }),
}));

jest.mock("@/services/BatchTranscriber", () => ({
  batchTranscriber: { transcribe: jest.fn() },
}));

jest.mock("@/services/HistoryService", () => ({
  HistoryService: { recordTranslation: jest.fn() },
}));

jest.mock("@/utils/toast", () => ({
  AppToast: {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock("@/utils/haptics", () => ({
  triggerHaptic: jest.fn(),
}));

jest.mock("@/store", () => {
  const { observable } = jest.requireActual("@legendapp/state");
  return {
    auth$: observable({
      session: null,
      user: null,
      isPro: false,
      isInitialized: false,
      sessionLoaded: false,
    }),
    history$: observable({}),
    settings$: observable({
      targetLanguage: "es",
      selectedLanguages: ["en"],
    }),
  };
});

jest.mock("expo-file-system", () => {
  return {
    File: class {
      constructor(mockUri: string) {
        this.uri = mockUri;
      }
      uri: string;
      exists = true;
      delete() {}
    },
  };
});

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: 0 },
}));

const ok = <T>(value: T) => ({ ok: true, value }) as const;
const fail = <E>(error: E) => ({ ok: false, error }) as const;

const transcription: TranscriptionResult = {
  transcript: "hello world",
  detectedLang: "en",
  sourceLang: "en",
  durationSeconds: 2.5,
  isLowQuality: false,
};

const mockTranscribe = jest.mocked(batchTranscriber.transcribe);
const mockRecord = jest.mocked(HistoryService.recordTranslation);
const mockToastError = jest.mocked(AppToast.error);
const mockInvalidate = jest.mocked(invalidateUsage);

describe("useResultPipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTranscribe.mockResolvedValue(ok(transcription));
    mockRecord.mockResolvedValue(undefined);
    (jest.mocked(triggerHaptic) as jest.Mock).mockResolvedValue(undefined);
    mockTranslate.mockResolvedValue(ok({ translation: "" }));
  });

  it("transcribes a shared-audio URI exactly once", async () => {
    const { result } = await renderHook(() =>
      useResultPipeline({ uri: "file:///tmp/a.m4a" }),
    );

    await waitFor(() => expect(result.current.isProcessing).toBe(false));
    await waitFor(() => expect(result.current.hasPolished).toBe(true));

    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(result.current.transcript).toBe("hello world");
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed URI on re-render (retry-guard)", async () => {
    mockTranscribe.mockResolvedValueOnce(fail(EkweError.TRANSCRIPTION_FAIL));

    const { result, rerender } = await renderHook(() =>
      useResultPipeline({ uri: "file:///tmp/a.m4a" }),
    );

    await waitFor(() => expect(result.current.isProcessing).toBe(false));
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.hasPolished).toBe(false);

    // Re-render with the same URI (e.g. parent state churn) must NOT re-fire.
    await rerender({ uri: "file:///tmp/a.m4a" });
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });

  it("skips transcription entirely for a history replay", async () => {
    const { result } = await renderHook(() =>
      useResultPipeline({
        uri: "file:///tmp/a.m4a",
        isHistoryReplay: true,
        initialTranscript: "cached transcript",
        initialSourceLang: "en",
        initialTargetLang: "fr",
      }),
    );

    expect(result.current.transcript).toBe("cached transcript");
    expect(result.current.isHistoryReplay).toBe(true);
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("syncs transcript/translation when the history entry resolves after mount", async () => {
    const entryId = "late-entry";
    const { result } = await renderHook(() =>
      useResultPipeline({
        entryId,
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    // Entry not yet hydrated: state is the mount-time default.
    expect(result.current.transcript).toBe("");
    expect(result.current.isHistoryReplay).toBe(false);

    await act(async () => {
      history$[entryId].set({
        id: entryId,
        sourceLang: "en",
        targetLang: "fr",
        transcript: "delayed transcript",
        translation: "delayed translation",
        timestamp: 1,
        duration: 0,
        sourceApp: null,
      });
    });

    // The late-resolving entry must populate the state, not stay stale.
    expect(result.current.transcript).toBe("delayed transcript");
    expect(result.current.translation).toBe("delayed translation");
    expect(result.current.isHistoryReplay).toBe(true);
  });

  it("translates the transcript and records it as a translation", async () => {
    mockTranslate.mockResolvedValue(ok({ translation: "hola mundo" }));

    const { result } = await renderHook(() =>
      useResultPipeline({
        initialTranscript: "hello",
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    await actAsync(() => result.current.handleTranslate());

    expect(mockTranslate).toHaveBeenCalledWith("hello", "en", "es");
    expect(result.current.translation).toBe("hola mundo");
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      transcript: "hello",
      translation: "hola mundo",
      type: "translation",
      provider: "gemini",
    });
  });

  it("does not record history on translation failure", async () => {
    mockTranslate.mockResolvedValueOnce(fail("QUOTA_EXCEEDED"));

    const { result } = await renderHook(() =>
      useResultPipeline({
        initialTranscript: "hello",
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    await actAsync(() => result.current.handleTranslate());

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.isTranslating).toBe(false);
  });

  it("skips translation history recording for a replay", async () => {
    mockTranslate.mockResolvedValue(ok({ translation: "hola mundo" }));

    const { result } = await renderHook(() =>
      useResultPipeline({
        isHistoryReplay: true,
        initialTranscript: "hello",
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    await actAsync(() => result.current.handleTranslate());

    expect(mockTranslate).toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
    expect(result.current.translation).toBe("hola mundo");
  });
});

async function actAsync(fn: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await fn();
  });
}
