import CheckCircle2 from "lucide-react-native/icons/circle-check";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React, { useCallback, useEffect, useRef } from "react";
import type { StyleProp, TextStyle } from "react-native";

import { ScrollableTextBox } from "@/components/ScrollableTextBox";
import { AnimatedCopyButton } from "@/components/AnimatedCopyButton";
import { IconButton } from "@/components/IconButton";

import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";
import { useEchoSpeech } from "@/hooks/echo/useEchoSpeech";

import { Box, Text, Spinner } from "@/components/ui";
import { EkweError } from "@/constants/errors";
import { LANGUAGES, getLanguageFlag } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks/ui";
import { withAlpha } from "@/utils/color";

import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";

interface TextBoxProps {
  text: string | null;
  height?: number;
  variant?: "default" | "accent" | "outlined";
  textStyle?: StyleProp<TextStyle>;

  lead: string;

  lang?: string | null;

  showFlag?: boolean;

  withCheck?: boolean;

  audioPlayer?: WaveformPlaybackController | null;

  /**
   * Shows the read-aloud control even when a source-audio player is present,
   * so a result can offer both the original voice note and its synthesized
   * translation.
   */
  allowTts?: boolean;

  copied?: boolean;
}

export const TextBox: React.FC<TextBoxProps> = React.memo(
  ({
    text,
    height = 300,
    variant = "default",
    textStyle,
    lead,
    lang,
    showFlag = false,
    withCheck = false,
    audioPlayer,
    allowTts,
    copied = false,
  }) => {
    const { color } = useTheme();

    const hasSource = !!audioPlayer;
    const hasTts = (allowTts ?? !hasSource) && !!lang;

    const handleSpeechError = useCallback(
      (error: EkweError): void => {
        const outage = error === EkweError.SPEECH_UNAVAILABLE;
        const overLimit = error === EkweError.TEXT_TOO_LONG;
        AppToast.error(
          outage
            ? "Voice temporarily unavailable"
            : overLimit
              ? "Text too long"
              : "Speech Unavailable",
          {
            description: outage
              ? "Every voice provider is busy right now. Try again in a moment."
              : overLimit
                ? "This result is longer than your plan allows. Upgrade to hear the full text."
                : "Failed to generate speech.",
            action: outage
              ? {
                  label: "Retry",
                  onClick: (): void => speakRef.current(text ?? "", lang ?? ""),
                }
              : undefined,
          },
        );
      },
      [text, lang],
    );

    const { isSpeaking, isLoading, speak, stop } = useEchoSpeech({
      onError: handleSpeechError,
    });

    // The toast captures `speak` at creation time; a ref keeps Retry calling
    // the latest instance even after loading/speaking state has changed.
    const speakRef = useRef(speak);
    useEffect(() => {
      speakRef.current = speak;
    });

    // Stop any in-flight synthesis or playback when the content or
    // visibility changes so a stale clip can never autoplay for new text.
    useEffect(() => {
      stop();
    }, [text, lang, hasTts, stop]);

    const langName = lang
      ? (LANGUAGES.find((l) => l.code === lang)?.englishName ?? lang)
      : null;
    const flag = lang ? getLanguageFlag(lang) : null;

    const handleSourceToggle = useCallback(async (): Promise<void> => {
      if (!audioPlayer) return;
      if (audioPlayer.isPlaying) {
        audioPlayer.pause();
      } else {
        await audioPlayer.playFromStart();
      }
    }, [audioPlayer]);

    const handleSpeakToggle = useCallback((): void => {
      if (!text || !lang) {
        logger.warn("[TextBox] Speech skipped: no text or language");
        return;
      }
      speak(text, lang);
    }, [text, lang, speak]);

    const labelColor = withCheck ? color.brand : color.foreground;

    return (
      <ScrollableTextBox
        text={text}
        height={height}
        variant={variant}
        textStyle={[{ ...typography.bodyLarge }, textStyle] as TextStyle[]}
        header={
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: spacing.md,
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
            }}
          >
            <Box
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              {withCheck && (
                <CheckCircle2
                  size={14}
                  color={color.success}
                  strokeWidth={2.5}
                />
              )}
              <Text
                variant="caption"
                numberOfLines={1}
                style={{ color: color.muted }}
              >
                {lead} ·
              </Text>
              <Text
                variant="caption"
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontWeight: "700",
                  color: labelColor,
                }}
              >
                {showFlag && flag ? `${flag} ` : ""}
                {langName}
              </Text>
            </Box>

            <Box
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                marginLeft: spacing.md,
              }}
            >
              {hasSource && (
                <IconButton
                  accessibilityLabel={
                    audioPlayer?.isPlaying
                      ? "Stop playing source audio"
                      : "Play source audio"
                  }
                  onPress={handleSourceToggle}
                  size={36}
                  backgroundColor={
                    audioPlayer?.isPlaying
                      ? color.brand
                      : withAlpha(color.foreground, 0.06)
                  }
                  icon={
                    audioPlayer?.isDecoding ||
                    audioPlayer?.isReady === false ? (
                      <Spinner size="sm" color={color.brand} />
                    ) : audioPlayer?.isPlaying ? (
                      <VolumeX size={18} color={color.onBrand} />
                    ) : (
                      <Volume2 size={18} color={color.foreground} />
                    )
                  }
                />
              )}
              {hasTts && (
                <IconButton
                  accessibilityLabel={
                    isSpeaking ? "Stop speaking" : "Listen to result"
                  }
                  onPress={isSpeaking ? stop : handleSpeakToggle}
                  size={36}
                  backgroundColor={
                    isSpeaking ? color.brand : withAlpha(color.foreground, 0.06)
                  }
                  icon={
                    isLoading ? (
                      <Spinner size="sm" color={color.brand} />
                    ) : isSpeaking ? (
                      <VolumeX size={18} color={color.onBrand} />
                    ) : (
                      <Volume2 size={18} color={color.foreground} />
                    )
                  }
                />
              )}
              <AnimatedCopyButton
                textToCopy={text ?? ""}
                accessibilityLabel={`Copy ${lead}`}
                copied={copied}
                size={18}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: withAlpha(color.foreground, 0.06),
                }}
              />
            </Box>
          </Box>
        }
      />
    );
  },
);
