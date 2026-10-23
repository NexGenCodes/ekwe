// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import type { EchoProps } from "@/types/echo";
import { useEchoFlow } from "@/hooks/echo/useEchoFlow";

interface TestObservable<T> {
  get(): T;
  peek(): T;
  set(value: Partial<T>): void;
}

interface SettingsState {
  autoCopy: boolean;
  targetLanguage: string;
}

interface SessionState {
  accessToken: string;
  user: { id: string };
}

interface AuthState {
  session: SessionState | null;
  isPro: boolean;
}

interface NetworkState {
  isConnected: boolean;
  isInternetReachable: boolean;
}

const impl = vi.hoisted(() => ({
  translate: vi.fn(),
  transcribe: vi.fn(),
  recordTranslation: vi.fn(),
  invalidateUsage: vi.fn(),
  triggerHaptic: vi.fn(),
  alertInfo: vi.fn(),
  dismissEcho: vi.fn(),
  cleanEchoCache: vi.fn(),
  checkIsOnline: vi.fn(),
}));

const permissions = vi.hoisted(() => ({
  autoCopy: true,
  autoLanguageDetect: false,
  cooldownSeconds: 0,
  dictationDurationMs: 120_000,
}));

const resolver = vi.hoisted(() => ({
  audioUri: "file:///shared/audio.m4a",
  isResolving: false,
  convertedWaveform: [] as number[],
  convertedDurationMs: 1000,
  resolveError: null as string | null,
  resolveRetryable: true,
  retryResolve: vi.fn(),
  activeResolvedUri: { current: "file:///shared/audio.m4a" },
  isSubsequentIntent: false,
  setIsSubsequentIntent: vi.fn(),
}));

const store = vi.hoisted(
  () =>
    ({}) as {
      settings$: TestObservable<SettingsState>;
      auth$: TestObservable<AuthState>;
      network$: TestObservable<NetworkState>;
    },
);

vi.mock("@/store", async () => {
  const { observable } = await import("@legendapp/state");
  store.settings$ = observable({
    autoCopy: true,
    targetLanguage: "en",
  }) as unknown as typeof store.settings$;
  store.auth$ = observable({
    session: { accessToken: "test-token", user: { id: "u1" } },
    isPro: true,
  }) as unknown as typeof store.auth$;
  store.network$ = observable({
    isConnected: true,
    isInternetReachable: true,
  }) as unknown as typeof store.network$;
  return {
    settings$: store.settings$,
    auth$: store.auth$,
    network$: store.network$,
  };
});

vi.mock("@/hooks/echo/useEchoAudioResolver", () => ({
  useEchoAudioResolver: () => resolver,
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => permissions,
}));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ translate: impl.translate }),
}));
vi.mock("@/hooks/queries/useUsageQuery", () => ({
  invalidateUsage: impl.invalidateUsage,
}));
vi.mock("@/services/batchTranscriber", () => ({
  batchTranscriber: { transcribe: impl.transcribe },
}));
vi.mock("@/services/historyService", () => ({
  HistoryService: { recordTranslation: impl.recordTranslation },
}));
vi.mock("@/services/intentService", () => ({
  IntentService: {
    dismissEcho: impl.dismissEcho,
    presentEcho: vi.fn(),
  },
}));
vi.mock("@/utils/haptics", () => ({ triggerHaptic: impl.triggerHaptic }));
vi.mock("@/utils/alert", () => ({
  AppAlert: { info: impl.alertInfo, alert: vi.fn() },
}));
vi.mock("@/utils/audioCache", () => ({ cleanEchoCache: impl.cleanEchoCache }));
vi.mock("@/utils/connectivity", () => ({
  checkIsOnline: impl.checkIsOnline,
  subscribeToNetwork: vi.fn(),
}));
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SUCCESS_TRANSCRIPT = {
  ok: true as const,
  value: { transcript: "hola mundo", detectedLang: "es", provider: "whisper" },
};
const SUCCESS_TRANSLATION = {
  ok: true as const,
  value: {
    translation: "hola mundo",
    provider: "llama",
    transliteration: "ola mundo",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  store.auth$.set({
    session: { accessToken: "test-token", user: { id: "u1" } },
  });
  permissions.autoCopy = true;
  permissions.autoLanguageDetect = false;
  permissions.cooldownSeconds = 0;
  permissions.dictationDurationMs = 120_000;
  resolver.convertedDurationMs = 1000;
  impl.transcribe.mockResolvedValue(SUCCESS_TRANSCRIPT);
  impl.translate.mockResolvedValue(SUCCESS_TRANSLATION);
  impl.checkIsOnline.mockResolvedValue(true);
  impl.recordTranslation.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

function renderFlow() {
  return renderHook(() => useEchoFlow({} as EchoProps));
}

describe("handleTranscribe", () => {
  it("transcribes the note and lands on the result step", async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });

    expect(impl.transcribe).toHaveBeenCalledTimes(1);
    expect(impl.transcribe.mock.calls[0][0]).toMatchObject({
      uri: "file:///shared/audio.m4a",
      durationMs: 1000,
    });
    expect(impl.transcribe.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(result.current.step).toBe("TranscribeResult");
    expect(result.current.transcription).toBe("hola mundo");
    expect(result.current.detectedLang).toBe("es");
    expect(result.current.error).toBeNull();
    expect(impl.invalidateUsage).toHaveBeenCalledTimes(1);
    expect(impl.triggerHaptic).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it("prompts for login when there is no active session", async () => {
    store.auth$.set({ session: null });
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });

    expect(impl.alertInfo).toHaveBeenCalledWith(
      "Login Required",
      "Please log in to translate your shared files.",
      expect.any(Array),
    );
    expect(impl.transcribe).not.toHaveBeenCalled();
    expect(result.current.step).toBe("PickLanguage");
  });

  it("rejects audio longer than the plan limit", async () => {
    permissions.dictationDurationMs = 60_000;
    resolver.convertedDurationMs = 120_000;
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });

    expect(result.current.step).toBe("Error");
    expect(result.current.error).toBe(
      "Audio exceeds your plan limit (60s). Please upgrade to Paid for longer files.",
    );
    expect(impl.transcribe).not.toHaveBeenCalled();
  });

  it("fails closed while offline without submitting the request", async () => {
    impl.checkIsOnline.mockResolvedValueOnce(false);
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });

    expect(result.current.step).toBe("Error");
    expect(result.current.error).toBe(
      "Transcription requires an active internet connection.",
    );
    expect(impl.transcribe).not.toHaveBeenCalled();
  });

  it("enforces the cooldown window between transcribe attempts", async () => {
    permissions.cooldownSeconds = 10;
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });
    expect(result.current.step).toBe("TranscribeResult");

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });

    expect(result.current.step).toBe("Error");
    expect(result.current.error).toMatch(
      /^Please wait \d+s before transcribing/,
    );
    expect(impl.transcribe).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request when cancelled", async () => {
    impl.transcribe.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = renderFlow();

    await act(async () => {
      const pending = result.current.handleTranscribe(2, []);
      await new Promise((resolve) => setTimeout(resolve, 0));
      result.current.cancelProcessing();
      void pending;
    });

    expect(impl.transcribe).toHaveBeenCalledTimes(1);
    expect(impl.transcribe.mock.calls[0][2].aborted).toBe(true);
  });
});

describe("handleTranslate", () => {
  it("translates the transcript and persists the history pair", async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });
    act(() => {
      result.current.setTargetLang("fr");
    });

    await act(async () => {
      await result.current.handleTranslate();
    });

    expect(impl.translate).toHaveBeenCalledTimes(1);
    expect(impl.translate.mock.calls[0]).toEqual([
      "hola mundo",
      "es",
      "fr",
      expect.any(AbortSignal),
    ]);
    expect(result.current.step).toBe("FullResult");
    expect(result.current.translation).toBe("hola mundo");
    expect(result.current.autoCopied).toBe(true);
    expect(vi.mocked(Clipboard.setStringAsync)).toHaveBeenCalledWith(
      `hola mundo${EKWE_SHARE_SIGNATURE}`,
    );
    // One row per capture. This used to write twice — a transcription-only
    // row and then a translation row — and because the dedup lookup keyed on
    // entry_type, the two could never match, so every translated note left an
    // orphan transcript behind in History.
    expect(impl.recordTranslation).toHaveBeenCalledTimes(1);
    expect(impl.recordTranslation.mock.calls[0][0]).toMatchObject({
      origin: "echo",
      input: "audio",
      type: "translation",
      transcript: "hola mundo",
      translation: "hola mundo",
      sourceLang: "es",
      targetLang: "fr",
    });
    expect(impl.recordTranslation.mock.calls[0][0].captureId).toBeTruthy();
    // Both of these came back with the translation and used to be written as
    // null — transliteration is what makes non-Latin scripts readable, and the
    // MT provider is a different model from the STT one.
    expect(impl.recordTranslation.mock.calls[0][0]).toMatchObject({
      transliteration: "ola mundo",
      mtProvider: "llama",
    });
  });

  it("retryOperation re-runs the failed translation", async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });
    impl.translate.mockResolvedValueOnce({
      ok: false,
      error: "worker exploded",
    });

    await act(async () => {
      await result.current.handleTranslate();
    });
    expect(result.current.step).toBe("Error");
    expect(result.current.error).toBe("worker exploded");

    impl.translate.mockResolvedValue(SUCCESS_TRANSLATION);
    await act(async () => {
      await result.current.retryOperation();
    });

    expect(result.current.step).toBe("FullResult");
    expect(result.current.translation).toBe("hola mundo");
  });
});

describe("onDismiss", () => {
  it("records a transcription-only row then freezes the flow", async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });
    expect(result.current.step).toBe("TranscribeResult");

    act(() => {
      result.current.onDismiss();
    });

    expect(impl.recordTranslation).toHaveBeenCalledTimes(1);
    expect(impl.recordTranslation.mock.calls[0][0]).toMatchObject({
      type: "transcription",
      transcript: "hola mundo",
      translation: null,
    });
    expect(impl.dismissEcho).toHaveBeenCalled();
    expect(impl.cleanEchoCache).toHaveBeenCalledWith(
      "file:///shared/audio.m4a",
    );

    await act(async () => {
      await result.current.handleTranscribe(2, []);
    });
    expect(impl.transcribe).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe("TranscribeResult");
  });
});
