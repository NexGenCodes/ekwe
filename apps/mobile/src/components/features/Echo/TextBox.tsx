import { triggerHaptic } from "@/utils/haptics";

import CheckCircle2 from "lucide-react-native/icons/circle-check";
import ShareIcon from "lucide-react-native/icons/share-2";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React, { useCallback, useEffect, useState } from "react";
import type { StyleProp, TextStyle } from "react-native";

import { ScrollableTextBox } from "@/components/ScrollableTextBox";
import { AnimatedCopyButton } from "@/components/AnimatedCopyButton";
import { IconButton } from "@/components/IconButton";

import { useSharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";
import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";
import { ShareOutService } from "@/services/shareOutService";
import { synthesizeSpeech } from "@/services/speech";

import { claimSpeechFocus, releaseSpeechFocus } from "@/hooks/audio/audioFocus";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
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

  showShare?: boolean;

  audioPlayer?: WaveformPlaybackController | null;

  /**
   * The received voice note. When present, the share sheet hands on the audio
   * itself instead of only its text — Echo already has the file in memory, so
   * there is nothing to look up and nothing to regenerate.
   */
  audioUri?: string | null;

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
    showShare = false,
    audioPlayer,
    audioUri = null,
    copied = false,
  }) => {
    const { color } = useTheme();

    const isSourceMode = !!audioPlayer;

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
      if (isSourceMode) return;
      if (isSpeaking || isSpeechLoading) {
        speechPlayer.pause();
        releaseSpeechFocus();
        setIsSpeaking(false);
        setIsSpeechLoading(false);
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSourceMode, text, lang]);

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

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isSourceMode) {
        if (!audioPlayer) return;
        if (audioPlayer.isPlaying) {
          audioPlayer.pause();
        } else {
          await audioPlayer.playFromStart();
        }
        return;
      }
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
          AppToast.error("Speech Unavailable", {
            description: "Failed to generate speech for this language.",
          });
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
    }, [
      isSourceMode,
      isSpeechLoading,
      isSpeaking,
      text,
      lang,
      audioPlayer,
      speechPlayer,
    ]);

    const handleShare = useCallback(async (): Promise<void> => {
      if (!text?.trim()) return;
      triggerHaptic("selection");
      // The service signs, tracks, and falls back to text if the audio cannot
      // be handed over — so this no longer needs its own try/catch.
      await ShareOutService.shareArtifact(audioUri, text, "echo");
    }, [audioUri, text]);

    const labelColor = withCheck ? color.brand : color.foreground;

    const stopSpeaking = useCallback(async (): Promise<void> => {
      if (isSourceMode) {
        audioPlayer?.pause();
        return;
      }
      if (!isSpeaking) return;
      speechPlayer.pause();
      releaseSpeechFocus();
      setIsSpeaking(false);
      setIsSpeechLoading(false);
    }, [isSourceMode, isSpeaking, audioPlayer, speechPlayer]);

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
              {(lang || isSourceMode) && (
                <IconButton
                  accessibilityLabel={
                    isSourceMode
                      ? audioPlayer?.isPlaying
                        ? "Stop playing source audio"
                        : "Play source audio"
                      : isSpeaking
                        ? "Stop speaking"
                        : "Listen to result"
                  }
                  onPress={
                    isSourceMode
                      ? handleSpeakToggle
                      : isSpeaking
                        ? stopSpeaking
                        : handleSpeakToggle
                  }
                  size={36}
                  backgroundColor={
                    isSourceMode
                      ? audioPlayer?.isPlaying
                        ? color.brand
                        : withAlpha(color.foreground, 0.06)
                      : isSpeaking
                        ? color.brand
                        : withAlpha(color.foreground, 0.06)
                  }
                  icon={
                    isSourceMode ? (
                      audioPlayer?.isDecoding ||
                      audioPlayer?.isReady === false ? (
                        <Spinner size="sm" color={color.brand} />
                      ) : audioPlayer?.isPlaying ? (
                        <VolumeX size={18} color={color.onBrand} />
                      ) : (
                        <Volume2 size={18} color={color.foreground} />
                      )
                    ) : isSpeechLoading ? (
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
              {showShare && (
                <Pressable
                  feedback="opacity"
                  accessibilityRole="button"
                  accessibilityLabel="Share result"
                  onPress={handleShare}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: withAlpha(color.foreground, 0.06),
                  }}
                >
                  <ShareIcon size={18} color={color.foreground} />
                </Pressable>
              )}
            </Box>
          </Box>
        }
      />
    );
  },
);
