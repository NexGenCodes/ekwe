// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useResultPipeline } from "@/hooks/useResultPipeline";
import { history$ } from "@/store";
import type { HistoryEntry } from "@/store";

import { HistoryService } from "@/services/historyService";
import { AppToast } from "@/utils/toast";

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

const ok = <T>(value: T) => ({ ok: true, value }) as const;
const fail = <E>(error: E) => ({ ok: false, error }) as const;

const mockRecord = vi.mocked(HistoryService.recordTranslation);
const mockToastError = vi.mocked(AppToast.error);

function storeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "entry-1",
    captureId: "cap-1",
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello",
    translation: "bonjour",
    transliteration: null,
    timestamp: 1,
    duration: 2,
    sourceApp: "com.whatsapp",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: "gemini",
    type: "translation",
    ...overrides,
  };
}

describe("useResultPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecord.mockResolvedValue(undefined);
    mockTranslate.mockResolvedValue(ok({ translation: "" }));
  });

  it("hydrates from a history entry", async () => {
    history$["entry-1"].set(storeEntry());

    const { result } = await renderHook(() =>
      useResultPipeline({ entryId: "entry-1" }),
    );

    expect(result.current.transcript).toBe("hello");
    expect(result.current.translation).toBe("bonjour");
    expect(result.current.isHistoryReplay).toBe(true);
  });

  it("falls back to the route params before an entry has paged in", async () => {
    const { result } = await renderHook(() =>
      useResultPipeline({
        entryId: "not-loaded",
        initialTranscript: "cached transcript",
        initialSourceLang: "en",
        initialTargetLang: "fr",
        isHistoryReplay: true,
      }),
    );

    expect(result.current.transcript).toBe("cached transcript");
    expect(result.current.sourceLang).toBe("en");
    expect(result.current.isHistoryReplay).toBe(true);
  });

  it("syncs when the history entry resolves after mount", async () => {
    const entryId = "late-entry";
    const { result } = await renderHook(() => useResultPipeline({ entryId }));

    expect(result.current.transcript).toBe("");

    await act(async () => {
      history$[entryId].set(
        storeEntry({
          id: entryId,
          transcript: "delayed transcript",
          translation: "delayed translation",
        }),
      );
    });

    expect(result.current.transcript).toBe("delayed transcript");
    expect(result.current.translation).toBe("delayed translation");
    expect(result.current.isHistoryReplay).toBe(true);
  });

  it("translates without writing to history", async () => {
    mockTranslate.mockResolvedValue(ok({ translation: "hola mundo" }));

    const { result } = await renderHook(() =>
      useResultPipeline({
        initialTranscript: "hello",
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    await act(async () => {
      await result.current.handleTranslate();
    });

    expect(mockTranslate).toHaveBeenCalledWith("hello", "en", "es");
    expect(result.current.translation).toBe("hola mundo");
    // The entry being shown is already in History; re-translating it must not
    // append a second row for the same capture.
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("surfaces a translation failure without recording", async () => {
    mockTranslate.mockResolvedValueOnce(fail("QUOTA_EXCEEDED"));

    const { result } = await renderHook(() =>
      useResultPipeline({
        initialTranscript: "hello",
        initialSourceLang: "en",
        initialTargetLang: "es",
      }),
    );

    await act(async () => {
      await result.current.handleTranslate();
    });

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.isTranslating).toBe(false);
  });

  it("never reports processing, because it no longer captures", async () => {
    const { result } = await renderHook(() =>
      useResultPipeline({ initialTranscript: "hello" }),
    );
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.hasPolished).toBe(false);
  });
});
