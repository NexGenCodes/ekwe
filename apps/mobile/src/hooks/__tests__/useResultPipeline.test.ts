// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useResultPipeline } from "@/hooks/useResultPipeline";
import { history$ } from "@/store";

import { batchTranscriber } from "@/services/batchTranscriber";
import { HistoryService } from "@/services/historyService";
import type { TranscriptionResult } from "@/services/transcribeAudio";
import { EkweError } from "@/constants/errors";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";
import { invalidateUsage } from "@/hooks/queries/useUsageQuery";

vi.mock("@/hooks/queries/useUsageQuery", () => ({
  invalidateUsage: vi.fn(),
  useUsageQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
}));

const mockTranslate = vi.fn();
vi.mock("../useTranslation", () => ({
  useTranslation: () => ({ translate: mockTranslate }),
}));

vi.mock("@/services/batchTranscriber", () => ({
  batchTranscriber: { transcribe: vi.fn() },
}));

vi.mock("@/services/historyService", () => ({
  HistoryService: { recordTranslation: vi.fn() },
}));

vi.mock("@/utils/toast", () => ({
  AppToast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/utils/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("@/store", async () => {
  const { observable } =
    await vi.importActual<typeof import("@legendapp/state")>(
      "@legendapp/state",
    );
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

vi.mock("expo-file-system", () => {
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

vi.mock("expo-haptics", () => ({
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

const mockTranscribe = vi.mocked(batchTranscriber.transcribe);
const mockRecord = vi.mocked(HistoryService.recordTranslation);
const mockToastError = vi.mocked(AppToast.error);
const mockInvalidate = vi.mocked(invalidateUsage);

describe("useResultPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTranscribe.mockResolvedValue(ok(transcription));
    mockRecord.mockResolvedValue(undefined);
    vi.mocked(triggerHaptic).mockResolvedValue(undefined);
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
