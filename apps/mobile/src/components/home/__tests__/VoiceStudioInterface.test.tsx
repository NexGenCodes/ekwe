// @vitest-environment jsdom
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpressiveInputProps } from "@/components/home/ExpressiveInput";
import type { VoiceResultPanelProps } from "@/components/home/VoiceResultPanel";

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (objs: Record<string, unknown>) => objs["ios"] || objs.default,
  },
  NativeModules: {},
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
  Keyboard: {
    dismiss: vi.fn(),
  },
  BackHandler: {
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
}));

import { VoiceStudioInterface } from "@/components/home/VoiceStudioInterface";

// Mock subcomponents
let capturedInputProps: ExpressiveInputProps | null = null;
vi.mock("@/components/home/ExpressiveInput", () => ({
  ExpressiveInput: (props: ExpressiveInputProps) => {
    capturedInputProps = props;
    return <div data-testid="expressive-input" />;
  },
}));

let capturedResultProps: VoiceResultPanelProps | null = null;
vi.mock("@/components/home/VoiceResultPanel", () => ({
  VoiceResultPanel: (props: VoiceResultPanelProps) => {
    capturedResultProps = props;
    return <div data-testid="voice-result-panel" />;
  },
}));

vi.mock("@/components/home/ShareVoiceSheet", () => ({
  ShareVoiceSheet: () => null,
}));

vi.mock("@/components/home/VoicePickerSheet", () => ({
  VoicePickerSheet: () => null,
}));

vi.mock("@/components/ui", () => ({
  Box: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => <div style={style}>{children}</div>,
}));

vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
}));

vi.mock("react-native-reanimated", () => {
  const LinearTransition = {
    springify: () => ({}),
  };
  return {
    default: {
      View: ({ children }: { children?: React.ReactNode }) => (
        <div>{children}</div>
      ),
    },
    LinearTransition,
  };
});

const mockCommitRecording = vi.fn();

vi.mock("@/hooks", () => ({
  usePermissions: () => ({
    autoLanguageDetect: false,
    maxSelectedLanguages: 5,
  }),
  useVoiceDictation: () => ({
    status: "idle",
    amplitude: 0,
    elapsedMs: 0,
    maxDurationMs: 60000,
    error: null,
    capturedUri: null,
    capturedDurationMs: 0,
    meteringData: [],
    interimText: "",
    finalText: "",
    isLive: false,
    startDictation: vi.fn(),
    stopDictation: vi.fn(),
    commitRecording: mockCommitRecording,
    cancelDictation: vi.fn(),
  }),
}));

const mockPlayerPlay = vi.fn();
const mockPlayerPause = vi.fn();
let mockPlayerIsPlaying = false;

vi.mock("@/hooks/audio/useSharedAudioPlayer", () => ({
  useSharedAudioPlayer: () => ({
    get isPlaying() {
      return mockPlayerIsPlaying;
    },
    isReady: true,
    isDecoding: false,
    loadError: null,
    pause: mockPlayerPause,
    play: mockPlayerPlay,
  }),
}));

vi.mock("@/hooks/audio/useVoicePreview", () => ({
  useVoicePreview: () => ({
    preview: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    activeKey: null,
    phase: "idle",
  }),
}));

vi.mock("@/utils/sessionAudioFiles", () => ({
  useSessionAudioFiles: () => ({
    remember: vi.fn(),
    deleteAfterDelay: vi.fn(),
    purge: vi.fn(),
  }),
}));

vi.mock("@/services/speech", () => ({
  synthesizeAudio: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("@/services/historyService", () => ({
  HistoryService: {
    recordTranslation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/services/shareOutService", () => ({
  ShareOutService: {
    shareTo: vi.fn(),
    shareArtifact: vi.fn(),
  },
}));

vi.mock("@/utils/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("@/utils/toast", () => ({
  AppToast: {
    error: vi.fn(),
  },
}));

vi.mock("@/utils/alert", () => ({
  AppAlert: {
    confirm: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { synthesizeSpeech, synthesizeAudio } from "@/services/speech";

describe("VoiceStudioInterface edit behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputProps = null;
    capturedResultProps = null;
  });

  it("restores the original text when clicking edit after text conversion with translation", async () => {
    const mockSynthesizeSpeech = vi.mocked(synthesizeSpeech);
    mockSynthesizeSpeech.mockResolvedValueOnce({
      ok: true,
      value: {
        uri: "file:///artifact.ogg",
        playbackUri: "file:///artifact.m4a",
        durationMs: 3000,
        waveform: [0.1, 0.5, 0.2],
        transcript: "Hello world",
        translation: "Hola mundo",
        sourceLang: "en",
        targetLang: "es",
      },
    });

    render(<VoiceStudioInterface />);

    // Enter source text and set target language to trigger translation
    act(() => {
      capturedInputProps?.onChangeText("Hello world");
      capturedInputProps?.onTargetChange?.("es");
    });

    // Convert
    await act(async () => {
      capturedInputProps?.onConvert();
    });

    // Should have transitioned to result panel showing translation as result
    expect(capturedResultProps).not.toBeNull();
    expect(capturedResultProps?.resultText).toBe("Hola mundo");
    expect(capturedResultProps?.transcriptText).toBe("Hello world");

    // Click Edit on the result panel
    act(() => {
      capturedResultProps?.onEdit();
    });

    // Composer should now display the ORIGINAL text "Hello world", not "Hola mundo"
    expect(capturedInputProps?.value).toBe("Hello world");
    expect(capturedInputProps?.hasRecording).toBe(false);
  });

  it("restores the original text (transcript) when clicking edit after audio conversion with translation", async () => {
    const mockSynthesizeAudio = vi.mocked(synthesizeAudio);
    mockSynthesizeAudio.mockResolvedValueOnce({
      ok: true,
      value: {
        uri: "file:///artifact.ogg",
        playbackUri: "file:///artifact.m4a",
        durationMs: 4000,
        waveform: [0.2, 0.6, 0.3],
        transcript: "Good morning friend",
        translation: "Bonjour mon ami",
        sourceLang: "en",
        targetLang: "fr",
      },
    });

    mockCommitRecording.mockReturnValueOnce({
      uri: "file:///recorded.m4a",
      durationMs: 2500,
      waveform: [0.1, 0.2],
    });

    render(<VoiceStudioInterface />);

    // Set target language to French
    act(() => {
      capturedInputProps?.onTargetChange?.("fr");
    });

    // Trigger dictation confirmation
    await act(async () => {
      capturedInputProps?.dictationState.onConfirm();
    });

    // Should have transitioned to result panel showing translation as result
    expect(capturedResultProps).not.toBeNull();
    expect(capturedResultProps?.resultText).toBe("Bonjour mon ami");
    expect(capturedResultProps?.transcriptText).toBe("Good morning friend");

    // Click Edit on the result panel
    act(() => {
      capturedResultProps?.onEdit();
    });

    // Composer should now display the ORIGINAL transcript "Good morning friend", not "Bonjour mon ami"
    expect(capturedInputProps?.value).toBe("Good morning friend");
    // Recording should be cleared so the user can edit the text
    expect(capturedInputProps?.hasRecording).toBe(false);
  });

  it("confirms that after generating audio the play button toggles playback", async () => {
    const mockSynthesizeSpeech = vi.mocked(synthesizeSpeech);
    mockSynthesizeSpeech.mockResolvedValueOnce({
      ok: true,
      value: {
        uri: "file:///artifact.ogg",
        playbackUri: "file:///artifact.m4a",
        durationMs: 3000,
        waveform: [0.1, 0.5, 0.2],
        transcript: "Testing playback",
        translation: null,
        sourceLang: "en",
        targetLang: "en",
      },
    });

    render(<VoiceStudioInterface />);

    act(() => {
      capturedInputProps?.onChangeText("Testing playback");
    });

    await act(async () => {
      capturedInputProps?.onConvert();
    });

    expect(capturedResultProps).not.toBeNull();
    mockPlayerPlay.mockClear();
    mockPlayerPause.mockClear();

    // Toggle play when not playing -> plays
    mockPlayerIsPlaying = false;
    act(() => {
      capturedResultProps?.onTogglePlay();
    });
    expect(mockPlayerPlay).toHaveBeenCalledTimes(1);
    expect(mockPlayerPause).not.toHaveBeenCalled();

    // Toggle play when already playing -> pauses
    mockPlayerIsPlaying = true;
    act(() => {
      capturedResultProps?.onTogglePlay();
    });
    expect(mockPlayerPause).toHaveBeenCalledTimes(1);
  });
});
