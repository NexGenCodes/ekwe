import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mimeFor,
  ShareOutService,
  TELEMETRY_KEY,
} from "@/services/shareOutService";

const shareAudioMock = vi.hoisted(() => vi.fn());
const rnShareMock = vi.hoisted(() => vi.fn());

// shareOutService reaches the native module through modules/ekwe-native, whose
// index calls requireNativeModule from `expo`. Stub `expo` so the call lands on
// our spy instead of the real bridge.
vi.mock("expo", () => ({
  requireNativeModule: () => ({ shareAudio: shareAudioMock }),
}));

// The project's react-native alias stub exposes no Share, and shareOutService
// needs it for shareText.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios },
  NativeModules: {},
  StyleSheet: { create: (s: unknown) => s },
  Share: { share: rnShareMock },
}));

const fileMock = vi.hoisted(() => ({
  exists: true,
  extension: ".ogg",
  copied: [] as string[],
  copyThrows: false,
  bytesThrows: false,
}));

vi.mock("expo-file-system", () => {
  class MockFile {
    exists = fileMock.exists;
    extension = fileMock.extension;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    create = vi.fn();
    write = vi.fn();
    copySync = vi.fn((dest: MockFile) => {
      if (fileMock.copyThrows) throw new Error("no space");
      fileMock.copied.push(dest.uri);
    });
    bytesSync = vi.fn(() => {
      if (fileMock.bytesThrows) throw new Error("cache gone");
      return new Uint8Array([1, 2, 3]);
    });
  }
  return {
    File: MockFile,
    Paths: { cache: { uri: "file:///cache/" } },
  };
});

const ARTIFACT = "file:///cache/ekwe_converted_123_abc.ogg";

describe("mimeFor", () => {
  it("declares the codecs parameter for Ogg/Opus, which is what earns voice-note rendering", () => {
    // WhatsApp allow-lists exactly this string for PTT, and Telegram requires
    // type.contains("codecs=opus"). Plain "audio/ogg" is a document there.
    expect(mimeFor("file:///cache/voice.ogg")).toBe("audio/ogg; codecs=opus");
    expect(mimeFor("file:///cache/voice.opus")).toBe("audio/ogg; codecs=opus");
    expect(mimeFor("file:///cache/voice.OGG")).toBe("audio/ogg; codecs=opus");
  });

  it("keeps plain types for everything else", () => {
    expect(mimeFor("file:///cache/voice.mp3")).toBe("audio/mpeg");
    expect(mimeFor("file:///cache/voice.m4a")).toBe("audio/mp4");
    expect(mimeFor("file:///cache/voice.wav")).toBe("audio/wav");
  });

  it("falls back to audio/* for unknown extensions", () => {
    expect(mimeFor("file:///cache/voice.xyz")).toBe("audio/*");
  });
});

describe("ShareOutService.shareAudio", () => {
  beforeEach(() => {
    fileMock.exists = true;
    fileMock.extension = ".ogg";
    fileMock.copied = [];
    fileMock.copyThrows = false;
    fileMock.bytesThrows = false;
    shareAudioMock.mockReset().mockResolvedValue({ success: true, error: "" });
    rnShareMock.mockReset().mockResolvedValue(undefined);
  });

  it("forwards the exact codecs MIME and the captioned transcript to native", async () => {
    const result = await ShareOutService.shareAudio(ARTIFACT, "hola mundo");

    expect(result).toBe(true);
    expect(shareAudioMock).toHaveBeenCalledTimes(1);
    const [path, mime, text] = shareAudioMock.mock.calls[0];
    expect(mime).toBe("audio/ogg; codecs=opus");
    // The caption is still composed and still handed to native, which decides
    // per-platform what to do with it: iOS can pair it with the audio, Android
    // must not, because EXTRA_TEXT next to EXTRA_STREAM turns the send into a
    // document and costs the voice-note rendering.
    expect(text).toBe(
      "hola mundo\n\n— Shared with Ekwe · Speak, we'll handle the rest",
    );
    expect(path).toBeTruthy();
  });

  it("titles the chooser with the app, not a capture-surface feature name", async () => {
    await ShareOutService.shareAudio(ARTIFACT, "hi");

    // Share-out is not a capture surface, so it borrows no feature name —
    // "Echo" is the share-in sheet.
    expect(shareAudioMock.mock.calls[0][3]).toBe("Send with Ekwe");
  });

  it("shares a human-readable copy so the original stays available for playback", async () => {
    await ShareOutService.shareAudio(ARTIFACT, "hi");

    // The studio plays from ARTIFACT, so it must be copied, never moved.
    expect(fileMock.copied).toHaveLength(1);
    expect(fileMock.copied[0]).toMatch(
      /^file:\/\/\/cache\/ekwe-voice-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}\.ogg$/,
    );
  });

  it("stages two same-day shares to different paths so neither overwrites the other", async () => {
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.111111)
      .mockReturnValueOnce(0.222222);
    try {
      await ShareOutService.shareAudio(ARTIFACT, "first");
      await ShareOutService.shareAudio(ARTIFACT, "second");
    } finally {
      random.mockRestore();
    }

    expect(fileMock.copied).toHaveLength(2);
    expect(fileMock.copied[0]).not.toBe(fileMock.copied[1]);
  });

  it("sends no caption when there is no transcript", async () => {
    await ShareOutService.shareAudio(ARTIFACT);

    expect(shareAudioMock.mock.calls[0][2]).toBeNull();
  });

  it("returns false without calling native when the artifact is missing", async () => {
    fileMock.exists = false;

    expect(await ShareOutService.shareAudio(ARTIFACT)).toBe(false);
    expect(shareAudioMock).not.toHaveBeenCalled();
  });

  it("returns false when native reports failure, and omits the caption", async () => {
    shareAudioMock.mockResolvedValue({
      success: false,
      error: "File not found",
    });

    expect(await ShareOutService.shareAudio(ARTIFACT, "hi")).toBe(false);
  });

  it("returns false when native throws", async () => {
    shareAudioMock.mockRejectedValue(new Error("boom"));

    expect(await ShareOutService.shareAudio(ARTIFACT, "hi")).toBe(false);
  });

  it("falls back to the untouched artifact when the copy fails", async () => {
    fileMock.copyThrows = true;

    expect(await ShareOutService.shareAudio(ARTIFACT, "hi")).toBe(true);
    // Byte-copy fallback writes in place at the intended name.
    expect(fileMock.copied).toHaveLength(0);
    expect(shareAudioMock.mock.calls[0][0]).toMatch(
      /^file:\/\/\/cache\/ekwe-voice-\d{4}-\d{2}-\d{2}-[a-z0-9]{4}\.ogg$/,
    );
  });

  it("falls back to the original uri when the copy cannot be prepared at all", async () => {
    // Both the fast path and the byte-copy fallback fail, so prepareShareFile
    // hands back the original — which still shares, just with the raw name.
    fileMock.copyThrows = true;
    fileMock.bytesThrows = true;

    expect(await ShareOutService.shareAudio(ARTIFACT, "hi")).toBe(true);
    expect(shareAudioMock.mock.calls[0][0]).toBe(ARTIFACT);
  });
});

describe("ShareOutService.shareText", () => {
  beforeEach(() => {
    rnShareMock.mockReset().mockResolvedValue(undefined);
  });

  it("appends the share signature", async () => {
    expect(await ShareOutService.shareText("hola")).toBe(true);
    expect(rnShareMock).toHaveBeenCalledWith({
      message: "hola\n\n— Shared with Ekwe · Speak, we'll handle the rest",
    });
  });

  it("returns false when the platform share sheet rejects", async () => {
    rnShareMock.mockRejectedValue(new Error("dismissed"));

    expect(await ShareOutService.shareText("hola")).toBe(false);
  });
});

const analyticsMock = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/utils/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/analytics")>();
  return { ...actual, track: analyticsMock.track };
});

describe("ShareOutService.shareArtifact", () => {
  beforeEach(() => {
    fileMock.exists = true;
    fileMock.extension = ".ogg";
    fileMock.copied = [];
    fileMock.copyThrows = false;
    fileMock.bytesThrows = false;
    shareAudioMock.mockReset().mockResolvedValue({ success: true, error: "" });
    rnShareMock.mockReset().mockResolvedValue(undefined);
    analyticsMock.track.mockReset();
  });

  it("sends the audio, not the text, when a file is available", async () => {
    expect(
      await ShareOutService.shareArtifact(ARTIFACT, "hola", "speech-studio"),
    ).toBe(true);

    expect(shareAudioMock).toHaveBeenCalledTimes(1);
    expect(rnShareMock).not.toHaveBeenCalled();
  });

  it("falls back to text when the audio cannot be shared", async () => {
    // History has no audio at all, and a missing cache file is not a reason to
    // hand the user an empty share sheet.
    expect(await ShareOutService.shareArtifact(null, "hola", "history")).toBe(
      true,
    );
    expect(rnShareMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to text when the native audio share fails", async () => {
    shareAudioMock.mockResolvedValue({ success: false, error: "no handler" });

    expect(await ShareOutService.shareArtifact(ARTIFACT, "hola", "echo")).toBe(
      true,
    );
    expect(rnShareMock).toHaveBeenCalledTimes(1);
  });

  it("reports failure rather than opening an empty sheet", async () => {
    // Neither artifact nor text: there is nothing to share, and an empty
    // chooser reads to the user as a broken button.
    expect(await ShareOutService.shareArtifact(null, null, "history")).toBe(
      false,
    );
    expect(rnShareMock).not.toHaveBeenCalled();
    expect(shareAudioMock).not.toHaveBeenCalled();
  });

  it("tracks the frozen telemetry key, not the renamed origin", () => {
    // The surface is "Speech Studio" and the origin is "speech-studio", but
    // result_shared dashboards key on "studio". The mapping lives in the
    // service so a future rename cannot move a reporting key.
    expect(TELEMETRY_KEY["speech-studio"]).toBe("studio");
    expect(TELEMETRY_KEY.echo).toBe("echo");
    expect(TELEMETRY_KEY.history).toBe("history");
    expect(TELEMETRY_KEY.orb).toBe("result");
  });

  it("tracks only after the share succeeded, not on a dismissal", async () => {
    shareAudioMock.mockResolvedValue({ success: false, error: "boom" });
    rnShareMock.mockRejectedValue(new Error("dismissed"));

    // Awaited rather than polled: a negative assertion inside waitFor passes
    // immediately, so it would not have caught a late tracking call.
    await expect(
      ShareOutService.shareArtifact(ARTIFACT, "hola", "speech-studio"),
    ).resolves.toBe(false);
    expect(analyticsMock.track).not.toHaveBeenCalled();
  });

  it("tracks once, with the artifact kind, on success", async () => {
    await ShareOutService.shareArtifact(ARTIFACT, "hola", "speech-studio");

    expect(analyticsMock.track).toHaveBeenCalledTimes(1);
    expect(analyticsMock.track).toHaveBeenCalledWith(expect.any(String), {
      source: "studio",
      kind: "audio",
    });
  });
});
