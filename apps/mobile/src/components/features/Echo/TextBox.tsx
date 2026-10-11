import CheckCircle2 from "lucide-react-native/icons/circle-check";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React, { useCallback, useEffect, useState } from "react";
import type { StyleProp, TextStyle } from "react-native";

import { ScrollableTextBox } from "@/components/ScrollableTextBox";
import { AnimatedCopyButton } from "@/components/AnimatedCopyButton";
import { IconButton } from "@/components/IconButton";

import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";
import { synthesizeSpeech } from "@/services/speech";

import { claimSpeechFocus, releaseSpeechFocus } from "@/hooks/audio/audioFocus";

import { Box, Text, Spinner } from "@/components/ui";
import { EkweError } from "@/constants/errors";
import { LANGUAGES, getLanguageFlag } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks/ui";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { withAlpha } from "@/utils/color";

import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";
import { cleanEchoCache } from "@/utils/audioCache";

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

    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isSpeechLoading, setIsSpeechLoading] = useState(false);
    const [speechAudioUri, setSpeechAudioUri] = useState<string | null>(null);
    const speechPlayer = useSharedAudioPlayer(speechAudioUri);

    useEffect(() => {
      if (
        isSpeechLoading &&
        speechAudioUri &&
        speechPlayer.isReady &&
        !speechPlayer.isDecoding
      ) {
        setIsSpeechLoading(false);
        setIsSpeaking(true);
        void speechPlayer.playFromStart();
      }
    }, [
      isSpeechLoading,
      speechAudioUri,
      speechPlayer.isReady,
      speechPlayer.isDecoding,
      speechPlayer,
    ]);

    useEffect(() => {
      if (isSpeaking && speechPlayer.isEnded) {
        setIsSpeaking(false);
        releaseSpeechFocus();
      }
    }, [isSpeaking, speechPlayer.isEnded]);

    const langName = lang
      ? (LANGUAGES.find((l) => l.code === lang)?.englishName ?? lang)
      : null;
    const flag = lang ? getLanguageFlag(lang) : null;

    useEffect(() => {
      if (!hasTts) return;
      if (isSpeaking || isSpeechLoading) {
        speechPlayer.pause();
        releaseSpeechFocus();
        setIsSpeaking(false);
        setIsSpeechLoading(false);
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasTts, text, lang]);

    useEffect(() => {
      return (): void => {
        speechPlayer.pause();
        releaseSpeechFocus();
        // The synthesized file was never cleaned up: every tap minted a new
        // one in the cache directory, and `EchoFinalResult` remounts this
        // component per tab, orphaning the previous file. The startup sweep
        // was the only thing reclaiming them.
        if (speechAudioUri) void cleanEchoCache(speechAudioUri);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speechAudioUri]);

    const handleSourceToggle = useCallback(async (): Promise<void> => {
      if (!audioPlayer) return;
      if (audioPlayer.isPlaying) {
        audioPlayer.pause();
      } else {
        await audioPlayer.playFromStart();
      }
    }, [audioPlayer]);

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isSpeechLoading || isSpeaking) return;
      if (!text || !lang) {
        logger.warn("[TextBox] Speech skipped: no text or language");
        return;
      }

      try {
        speechPlayer.pause();
        releaseSpeechFocus();
      } catch (err) {
        logger.warn("speechPlayer.pause failed", err);
      }

      track(AnalyticsEvents.SPEECH_PLAYED, { source: "echo", lang });

      setIsSpeechLoading(true);
      claimSpeechFocus(() => {
        speechPlayer.pause();
      });

      try {
        const result = await synthesizeSpeech(text, lang);
        if (result.ok) {
          setSpeechAudioUri(result.value.uri);
        } else {
          setIsSpeechLoading(false);
          releaseSpeechFocus();
          // A provider outage is transient and not the user's fault, so it gets
          // its own wording and a retry. Reporting it as a generic failure —
          // which is what this did — told the user their language was the
          // problem and offered no way out of a busy provider.
          const outage = result.error === EkweError.SPEECH_UNAVAILABLE;
          AppToast.error(
            outage ? "Voice temporarily unavailable" : "Speech Unavailable",
            {
              description: outage
                ? "Every voice provider is busy right now. Try again in a moment."
                : "Failed to generate speech.",
              action: outage
                ? {
                    label: "Retry",
                    onClick: (): void => void handleSpeakToggle(),
                  }
                : undefined,
            },
          );
        }
      } catch (err) {
        setIsSpeechLoading(false);
        releaseSpeechFocus();
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn("[TextBox] Speech threw exception:", errorMsg);
        AppToast.error("Speech Unavailable", {
          description:
            "Your device does not support text-to-speech for this language.",
        });
      }
    }, [isSpeechLoading, isSpeaking, text, lang, speechPlayer]);

    const labelColor = withCheck ? color.brand : color.foreground;

    const stopSpeaking = useCallback(async (): Promise<void> => {
      if (!isSpeaking) return;
      speechPlayer.pause();
      releaseSpeechFocus();
      setIsSpeaking(false);
      setIsSpeechLoading(false);
    }, [isSpeaking, speechPlayer]);

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
                  onPress={isSpeaking ? stopSpeaking : handleSpeakToggle}
                  size={36}
                  backgroundColor={
                    isSpeaking ? color.brand : withAlpha(color.foreground, 0.06)
                  }
                  icon={
                    isSpeechLoading ? (
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
