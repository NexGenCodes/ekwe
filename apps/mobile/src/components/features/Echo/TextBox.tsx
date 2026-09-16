import { triggerHaptic } from "@/utils/haptics";
import { useSelector } from "@legendapp/state/react";
import * as Speech from "expo-speech";
import type { Voice } from "expo-speech";
import CheckCircle2 from "lucide-react-native/icons/circle-check";
import ShareIcon from "lucide-react-native/icons/share-2";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React, { useCallback, useEffect, useState } from "react";
import { Share, type StyleProp, type TextStyle } from "react-native";

import { ScrollableTextBox } from "../../ScrollableTextBox";
import { AnimatedCopyButton } from "../../AnimatedCopyButton";
import { IconButton } from "../../IconButton";

import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";

import { claimTtsFocus, releaseTtsFocus } from "@/hooks/audio/audioFocus";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { ECHO_SHARE_SIGNATURE } from "@/constants/echo";
import { LANGUAGES, getLanguageFlag } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { typography } from "@/constants/typography";
import { useTheme } from "@/hooks/ui";
import { settings$ } from "@/store";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { withAlpha } from "@/utils/color";
import {
  loadDeviceVoices,
  pickDeviceVoice,
  isMissingVoiceError,
} from "@/utils/deviceVoice";
import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";

interface TextBoxProps {
  text: string | null;
  height?: number;
  variant?: "default" | "accent" | "outlined";
  textStyle?: StyleProp<TextStyle>;
  /**
   * Muted descriptor that leads the label, e.g. "Translation" or "Transcription".
   * Pair it with `lang` so the natural read is "Translation · Zulu".
   */
  lead: string;
  /** Language code used for the language name, the flag, and TTS voice. */
  lang?: string | null;
  /** Render the flag after the language name (used where there is no tab bar). */
  showFlag?: boolean;
  /** Prefix the label with a success check (the Translated result). */
  withCheck?: boolean;
  /** Expose a native Share sheet for the text. */
  showShare?: boolean;
  /**
   * When provided, the "speaker" button plays the real source audio through this
   * player (owned by the caller) instead of text-to-speech. Used for the
   * Original/Transcription result, where the original recording still exists.
   */
  audioPlayer?: WaveformPlaybackController | null;
  /**
   * Brand footer appended to the text when copied or shared (the "Ekwe
   * signature"). Pass an empty string to omit it.
   */
  signature?: string;
  /**
   * External "copied" signal (e.g. from an auto-copy) that forces the copy
   * button's check state without a press. Consumed transiently by the parent.
   */
  copied?: boolean;
}

/**
 * Reusable audio-result text card: a "Speech ⇄ text" box with a compact header
 * row (language label left, actions right) and a scrollable body. It owns its
 * own text-to-speech state so the same Listen/Copy/Share controls can appear on
 * both the Final Result and Transcribe Result steps without duplicating logic.
 */
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
    signature = ECHO_SHARE_SIGNATURE,
    copied = false,
  }) => {
    const { color } = useTheme();

    // Source-audio mode: the speaker button controls the caller-owned player for
    // the original recording instead of text-to-speech.
    const isSourceMode = !!audioPlayer;

    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isTTSLoading, setIsTTSLoading] = useState(false);
    const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
    const ttsVoice = useSelector(() => settings$.ttsVoice.get());

    useEffect(() => {
      let active = true;
      loadDeviceVoices().then((voices) => {
        if (active) setAvailableVoices(voices);
      });
      return (): void => {
        active = false;
      };
    }, []);

    // Text with the brand signature appended, used for both copy and share so a
    // pasted result always carries the Ekwe call-to-action.
    const signedText = text ? `${text}${signature}` : "";

    const langName = lang
      ? (LANGUAGES.find((l) => l.code === lang)?.englishName ?? lang)
      : null;
    const flag = lang ? getLanguageFlag(lang) : null;

    // Stop TTS if the text (tab switch, new result) or target language changes.
    useEffect(() => {
      if (isSourceMode) return;
      if (isSpeaking || isTTSLoading) {
        Speech.stop().catch(() => {});
        releaseTtsFocus();
        setIsSpeaking(false);
        setIsTTSLoading(false);
      }
      // Only react to content changes, not the transient speaking flags.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSourceMode, text, lang]);

    // Stop TTS on unmount / sheet close.
    useEffect(() => {
      return (): void => {
        Speech.stop().catch(() => {});
        releaseTtsFocus();
      };
    }, []);

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isSourceMode) {
        if (!audioPlayer) return;
        if (audioPlayer.isPlaying) {
          audioPlayer.pause();
        } else {
          // The results speaker plays the original recording clean: from the
          // start at normal speed, independent of any preview scrub position.
          await audioPlayer.playFromStart();
        }
        return;
      }
      if (isTTSLoading || isSpeaking) return;
      if (!text || !lang) {
        logger.warn("[TextBox] TTS skipped: no text or language");
        return;
      }

      try {
        await Speech.stop();
        releaseTtsFocus();
      } catch (err) {
        logger.warn("Speech.stop failed", err);
      }

      track(AnalyticsEvents.TTS_PLAYED, { source: "echo", lang });

      setIsTTSLoading(true);
      claimTtsFocus(() => {
        Speech.stop().catch(() => {});
      });

      // Honor the selected narrator gender on device speech. Falls back to the
      // platform default when no matching voice exists so Listen still works.
      const deviceVoice = pickDeviceVoice(availableVoices, lang, ttsVoice);

      try {
        Speech.speak(text, {
          language: lang,
          ...(deviceVoice ? { voice: deviceVoice.identifier } : {}),
          onStart: (): void => {
            setIsTTSLoading(false);
            setIsSpeaking(true);
          },
          onDone: (): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
            releaseTtsFocus();
          },
          onStopped: (): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
            releaseTtsFocus();
          },
          onError: (e): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
            releaseTtsFocus();

            const errorMsg = e instanceof Error ? e.message : String(e);
            logger.warn("[TextBox] TTS error:", errorMsg);

            if (
              errorMsg.includes("interrupted") ||
              errorMsg.includes("stopped")
            ) {
              return;
            }

            AppToast.error(
              isMissingVoiceError(errorMsg)
                ? "Voice Not Installed"
                : "Speech Unavailable",
              {
                description: isMissingVoiceError(errorMsg)
                  ? "Add the voice for this language in your device Settings, then try again."
                  : "Your device does not support text-to-speech for this language, or the voice is not downloaded.",
              },
            );
          },
        });
      } catch (err) {
        setIsSpeaking(false);
        setIsTTSLoading(false);
        releaseTtsFocus();
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn("[TextBox] TTS threw exception:", errorMsg);
        AppToast.error(
          isMissingVoiceError(errorMsg)
            ? "Voice Not Installed"
            : "Speech Unavailable",
          {
            description: isMissingVoiceError(errorMsg)
              ? "Add the voice for this language in your device Settings, then try again."
              : "Your device does not support text-to-speech for this language.",
          },
        );
      }
    }, [
      isSourceMode,
      isTTSLoading,
      isSpeaking,
      text,
      lang,
      ttsVoice,
      availableVoices,
      audioPlayer,
    ]);

    const handleShare = useCallback(async (): Promise<void> => {
      if (!signedText) return;
      triggerHaptic("selection");
      try {
        track(AnalyticsEvents.RESULT_SHARED, { source: "echo" });
        await Share.share({ message: signedText });
      } catch (err) {
        logger.warn("[TextBox] Share failed", err);
      }
    }, [signedText]);

    const labelColor = withCheck ? color.brand : color.foreground;

    const stopSpeaking = useCallback(async (): Promise<void> => {
      if (isSourceMode) {
        audioPlayer?.pause();
        return;
      }
      if (!isSpeaking) return;
      try {
        await Speech.stop();
      } catch (err) {
        logger.warn("Speech.stop failed", err);
      }
      releaseTtsFocus();
      setIsSpeaking(false);
      setIsTTSLoading(false);
    }, [isSourceMode, isSpeaking, audioPlayer]);

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
                      audioPlayer?.isLoaded === false ? (
                        <Spinner size="sm" color={color.brand} />
                      ) : audioPlayer?.isPlaying ? (
                        <VolumeX size={18} color={color.onBrand} />
                      ) : (
                        <Volume2 size={18} color={color.foreground} />
                      )
                    ) : isTTSLoading ? (
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
                textToCopy={signedText}
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
