// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EchoFinalResult } from "@/components/features/Echo/EchoFinalResult";
import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";

// Chrome is stubbed: these imports pull in lucide-react-native, which requires
// react-native from inside node_modules where the project's `react-native`
// alias doesn't apply — Node then chokes on a Flow line in the real package.
type CapturedTextBoxProps = {
  audioPlayer?: unknown;
  allowTts?: boolean;
};

const textBoxProps = vi.hoisted(() => [] as CapturedTextBoxProps[]);
vi.mock("@/components/features/Echo/TextBox", () => ({
  TextBox: (props: CapturedTextBoxProps): React.ReactElement => {
    textBoxProps.push(props);
    return <></>;
  },
}));

vi.mock("@/components/ui", () => {
  const stub = (): React.ReactElement => <></>;
  return { Box: stub, Text: stub, Pressable: stub };
});

vi.mock("@/hooks/ui", () => ({
  useTheme: () => ({ color: {} }),
}));

vi.mock("@/utils/haptics", () => ({ triggerHaptic: vi.fn() }));

vi.mock("@/constants/languages", () => ({
  getLanguageFlag: () => "",
}));

vi.mock("lucide-react-native/icons/zap", () => ({ default: () => <></> }));
vi.mock("lucide-react-native/icons/circle-check", () => ({
  default: () => <></>,
}));

const BASE = {
  transcription: "hello there",
  translation: "hola",
  sourceLang: "en",
  targetLang: "es",
  setStep: vi.fn(),
  handleClose: vi.fn(),
  onTabChange: vi.fn(),
  copied: false,
};

const player = {
  playFromStart: vi.fn(),
} as unknown as WaveformPlaybackController;

describe("EchoFinalResult playback wiring", () => {
  beforeEach(() => {
    textBoxProps.length = 0;
  });

  it("offers only the synthesized read-aloud on the Translated tab", () => {
    render(
      <EchoFinalResult {...BASE} activeTab="Translated" audioPlayer={player} />,
    );

    expect(textBoxProps).toHaveLength(1);
    expect(textBoxProps[0]?.audioPlayer).toBeNull();
    expect(textBoxProps[0]?.allowTts).toBe(true);
  });

  it("offers only the original voice note on the Original tab", () => {
    render(
      <EchoFinalResult {...BASE} activeTab="Original" audioPlayer={player} />,
    );

    expect(textBoxProps[0]?.audioPlayer).toBe(player);
    expect(textBoxProps[0]?.allowTts).toBe(false);
  });
});
