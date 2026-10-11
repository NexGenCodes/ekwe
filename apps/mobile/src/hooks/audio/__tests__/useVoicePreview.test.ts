// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { getStandardSlot, STUDIO_VOICE_ID } from "@ekwe/shared";

import type { VoiceSelection } from "@/utils/voices";
import type { SessionAudioFiles } from "@/utils/sessionAudioFiles";

/** Deferred syntheses so a test can resolve them out of order. */
interface Pending {
  voiceId: string;
  gender: string;
  settle: (value: unknown) => void;
}

const pending: Pending[] = [];

const playFromStart = vi.fn();
const pause = vi.fn();
let isPlaying = false;
let isLoaded = true;
let isDecoding = false;
let isReady = true;

vi.mock("@/hooks/audio/useSharedAudioPlayer", () => ({
  useSharedAudioPlayer: () => ({
    playFromStart,
    pause,
    isPlaying,
    isLoaded,
    isReady,
    isDecoding,
    progress: 0,
    progressSV: { value: 0 },
    duration: 0,
    isEnded: false,
    playbackRate: 1,
    play: vi.fn(),
    release: vi.fn(),
    setPlaybackRate: vi.fn(),
    beginScrub: vi.fn(),
    endScrub: vi.fn(),
  }),
}));

vi.mock("@/services/speech", () => ({
  synthesizeSpeech: (
    text: string,
    lang: string,
    options: { voiceId?: string; gender?: string },
  ): Promise<unknown> => {
    return new Promise((resolve) => {
      pending.push({
        voiceId: options.voiceId ?? "",
        gender: options.gender ?? "",
        settle: resolve,
      });
    });
  },
}));

/** Set to false to simulate a cache move that could not happen. */
let persistSucceeds = true;

vi.mock("@/utils/voicePreviewCache", () => ({
  getCachedPreviewUri: () => null,
  persistPreview: (uri: string, key: string) =>
    Promise.resolve(
      persistSucceeds ? `file:///mock/cache/ekwe_vpreview_v1_${key}.ogg` : uri,
    ),
  clearStalePreviewCache: vi.fn(),
}));

import { useVoicePreview } from "@/hooks/audio/useVoicePreview";
import { EkweError, ErrorMessages } from "@/constants/errors";

const files: SessionAudioFiles = {
  remember: vi.fn(),
  deleteAfterDelay: vi.fn(),
  purge: vi.fn(),
};

const onError = vi.fn();

const selection = (
  slotId: string,
  gender: "male" | "female",
): VoiceSelection => ({
  slot: { ...getStandardSlot(), id: slotId },
  gender,
});

const mount = () =>
  renderHook(() => useVoicePreview({ lang: "en", files, onError }));

const resolvePending = async (index: number, uri: string): Promise<void> => {
  await act(async () => {
    pending[index].settle({
      ok: true,
      value: { uri, durationMs: 100 },
    });
  });
};

beforeEach(() => {
  pending.length = 0;
  playFromStart.mockClear();
  pause.mockClear();
  onError.mockClear();
  vi.mocked(files.deleteAfterDelay).mockClear();
  isPlaying = false;
  isLoaded = true;
  isDecoding = false;
  isReady = true;
  persistSucceeds = true;
});

describe("useVoicePreview", () => {
  it("drops a preview that lost to a tab switch, so it never plays", async () => {
    const { result } = mount();

    // Tap play on the male tab.
    act(() => {
      result.current.preview(selection(getStandardSlot().id, "male"));
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].gender).toBe("male");
    expect(result.current.phase).toBe("loading");

    // Switch to the female tab before the clip arrives.
    act(() => {
      result.current.cancel();
    });
    expect(result.current.activeKey).toBeNull();

    // The male clip finally lands.
    await resolvePending(0, "file:///male.ogg");

    // This is the reported bug: the male voice used to start playing here.
    expect(playFromStart).not.toHaveBeenCalled();
    expect(result.current.activeKey).toBeNull();
    // And the orphaned file is not left behind.
    expect(files.deleteAfterDelay).toHaveBeenCalledWith("file:///male.ogg");
  });

  it("plays the clip once it is loaded and decoded", async () => {
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await resolvePending(0, "file:///female.ogg");

    expect(playFromStart).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("playing");
    expect(result.current.activeKey).toBe(`${getStandardSlot().id}_female_en`);
  });

  it("keeps the spinner up until the clip finishes decoding", async () => {
    const { result, rerender } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    isDecoding = true;
    await resolvePending(0, "file:///female.ogg");

    expect(playFromStart).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("loading");

    isDecoding = false;
    rerender();

    expect(playFromStart).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("playing");
  });

  it("lets the last of several rapid taps win", async () => {
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    act(() => {
      result.current.preview(selection(STUDIO_VOICE_ID, "female"));
    });
    expect(pending).toHaveLength(2);

    // The stale first request resolves last, as it would on a real network.
    await resolvePending(1, "file:///studio.ogg");
    await resolvePending(0, "file:///standard.ogg");

    expect(playFromStart).toHaveBeenCalledTimes(1);
    expect(result.current.activeKey).toBe(`${STUDIO_VOICE_ID}_female_en`);
  });

  it("stops the sounding preview when its own button is tapped again", async () => {
    const { result, rerender } = mount();
    const target = selection(getStandardSlot().id, "female");

    act(() => {
      result.current.preview(target);
    });
    await resolvePending(0, "file:///female.ogg");
    isPlaying = true;
    rerender();
    expect(playFromStart).toHaveBeenCalledTimes(1);

    // Second tap on the same card toggles it off.
    act(() => {
      result.current.preview(target);
    });

    expect(pause).toHaveBeenCalled();
    expect(result.current.activeKey).toBeNull();
    expect(result.current.phase).toBeNull();
    // Toggling off must not issue another request.
    expect(pending).toHaveLength(1);
  });

  it("stops the current voice when another one is auditioned", async () => {
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await resolvePending(0, "file:///female.ogg");
    isPlaying = true;
    pause.mockClear();

    act(() => {
      result.current.preview(selection(STUDIO_VOICE_ID, "male"));
    });

    expect(pause).toHaveBeenCalled();
    expect(pending[1].gender).toBe("male");
  });

  it("surfaces a failure and returns to an idle button", async () => {
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await act(async () => {
      pending[0].settle({ ok: false, error: "EKWE_SPEECH_FAIL" });
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(playFromStart).not.toHaveBeenCalled();
    expect(result.current.activeKey).toBeNull();
    expect(result.current.phase).toBeNull();
  });

  it("reports the quota error by name so the UI can say the limit was reached", async () => {
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await act(async () => {
      pending[0].settle({ ok: false, error: EkweError.QUOTA_EXCEEDED });
    });

    expect(onError).toHaveBeenCalledWith(EkweError.QUOTA_EXCEEDED);
    expect(ErrorMessages[EkweError.QUOTA_EXCEEDED]).toMatch(/limit/i);
    expect(result.current.activeKey).toBeNull();
  });

  it("waits for readiness rather than a stale loaded flag", async () => {
    const { result, rerender } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    // The source swap is still in flight: expo-audio reports the previous
    // clip as loaded while the new one preloads.
    isReady = false;
    await resolvePending(0, "file:///female.ogg");

    expect(playFromStart).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("loading");

    isReady = true;
    rerender();

    expect(playFromStart).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("playing");
  });

  it("keeps the memoized clip on reset instead of deleting it", async () => {
    const { result } = mount();
    const key = `${getStandardSlot().id}_female_en`;

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await resolvePending(0, "file:///female.ogg");
    vi.mocked(files.deleteAfterDelay).mockClear();

    act(() => {
      result.current.reset();
    });

    // persistPreview moved the temp away, so there is nothing left to clean up
    // and the memo must survive for the next audition.
    expect(vi.mocked(files.deleteAfterDelay).mock.calls).not.toContainEqual([
      `file:///mock/cache/ekwe_vpreview_v1_${key}.ogg`,
    ]);
    expect(result.current.activeKey).toBeNull();
  });

  it("deletes the temp clip on reset when persisting failed", async () => {
    persistSucceeds = false;
    const { result } = mount();

    act(() => {
      result.current.preview(selection(getStandardSlot().id, "female"));
    });
    await resolvePending(0, "file:///orphan.ogg");
    vi.mocked(files.deleteAfterDelay).mockClear();

    act(() => {
      result.current.reset();
    });

    // The move failed, so the temp is still the only file and is disposable.
    expect(files.deleteAfterDelay).toHaveBeenCalledWith("file:///orphan.ogg");
  });
});
