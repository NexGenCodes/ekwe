import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import { useFocusEffect } from "expo-router";

import Copy from "lucide-react-native/icons/copy";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import Check from "lucide-react-native/icons/check";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Share } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

import { IconButton } from "@/components/IconButton";
import { SkeletonBox } from "@/components/SkeletonBox";
import { Transliteration } from "@/components/Transliteration";

import { claimSpeechFocus, releaseSpeechFocus } from "@/hooks/audio/audioFocus";

import { Box, Text, Spinner, ScrollArea } from "@/components/ui";
import { shadows } from "@/constants/shadows";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { synthesizeSpeech } from "@/services/speech";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { cleanEchoCache } from "@/utils/audioCache";
import { withAlpha } from "@/utils/color";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";

import logger from "@/utils/logger";

export interface ExpressiveOutputProps {
  translation: string | null;
  isTranslating: boolean;
  copied: boolean;
  onCopy?: () => void;
  targetLang?: string;
  transliteration?: string | null;
}

function waitForPlayerLoad(
  player: AudioPlayer,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      try {
        if (player.currentStatus.isLoaded) {
          resolve(true);
          return;
        }
      } catch {
        resolve(false);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export const ExpressiveOutput = React.memo(
  ({
    translation,
    isTranslating,
    copied,
    onCopy,
    targetLang,
    transliteration,
  }: ExpressiveOutputProps): React.ReactElement | null => {
    const { color } = useTheme();
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isSpeechLoading, setIsSpeechLoading] = useState(false);

    const speechAbortRef = useRef<AbortController | null>(null);
    const speechPlayerRef = useRef<{ player: AudioPlayer; uri: string } | null>(
      null,
    );

    const stopRequestedRef = useRef(0);

    const stopPlayback = useCallback((): void => {
      stopRequestedRef.current += 1;
      const controller = speechAbortRef.current;
      if (controller) {
        speechAbortRef.current = null;
        controller.abort();
      }
      const active = speechPlayerRef.current;
      if (active) {
        speechPlayerRef.current = null;
        try {
          active.player.pause();
        } catch {
          // already released
        }
        try {
          active.player.remove();
        } catch {
          // already released
        }
        cleanEchoCache(active.uri);
      }
      setAudioModeAsync({ interruptionMode: "mixWithOthers" }).catch(() => {});
      setIsAudioActiveAsync(false).catch(() => {});
    }, []);

    const stopAllPlayback = useCallback((): void => {
      stopPlayback();
      releaseSpeechFocus();
      setIsSpeaking(false);
      setIsSpeechLoading(false);
    }, [stopPlayback]);

    const startCloudSpeech = useCallback(
      async (text: string, lang: string): Promise<boolean> => {
        const controller = new AbortController();
        speechAbortRef.current = controller;
        claimSpeechFocus(stopAllPlayback);
        setIsSpeechLoading(true);

        try {
          const result = await synthesizeSpeech(text, lang, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return false;
          if (!result.ok) {
            logger.warn(
              "[ExpressiveOutput] Cloud speech unavailable:",
              result.error,
            );
            return false;
          }

          const player = createAudioPlayer(result.value.uri);
          speechPlayerRef.current = { player, uri: result.value.uri };
          player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
            if (status.didJustFinish) stopAllPlayback();
          });

          await setAudioModeAsync({ interruptionMode: "doNotMix" });
          await setIsAudioActiveAsync(true);
          player.play();

          const loaded = await waitForPlayerLoad(player, 2000);
          if (!loaded || controller.signal.aborted) {
            stopAllPlayback();
            if (!loaded) {
              logger.warn(
                "[ExpressiveOutput] Cloud speech audio failed to load",
              );
            }
            return false;
          }

          setIsSpeechLoading(false);
          setIsSpeaking(true);
          return true;
        } catch (err) {
          logger.warn(
            "[ExpressiveOutput] Cloud speech threw, falling back:",
            err,
          );
          return false;
        }
      },
      [stopAllPlayback],
    );

    useEffect(() => {
      if (isSpeaking || isSpeechLoading) {
        stopAllPlayback();
      }

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [translation]);

    useFocusEffect(
      useCallback((): (() => void) => {
        return (): void => {
          stopAllPlayback();
        };
      }, [stopAllPlayback]),
    );

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isSpeechLoading) return;

      await triggerHaptic();

      if (isSpeaking) {
        stopAllPlayback();
        return;
      }

      if (!translation || !targetLang) return;

      track(AnalyticsEvents.SPEECH_PLAYED, { source: "home", targetLang });

      stopPlayback();

      const stopEpoch = stopRequestedRef.current;
      const started = await startCloudSpeech(translation, targetLang);
      if (started) return;

      if (stopRequestedRef.current !== stopEpoch) return;

      setIsSpeechLoading(false);
      AppToast.error("Speech Unavailable", {
        description: "Failed to generate speech for this language.",
      });
    }, [
      isSpeaking,
      isSpeechLoading,
      translation,
      targetLang,
      startCloudSpeech,
      stopAllPlayback,
      stopPlayback,
    ]);

    const listenLabelStyle = useMemo(
      () => ({
        color: isSpeaking ? color.onBrand : withAlpha(color.onBrand, 0.8),
      }),
      [isSpeaking, color.onBrand],
    );

    const copyLabelStyle = useMemo(
      () => ({
        color: copied ? color.onBrand : withAlpha(color.onBrand, 0.8),
      }),
      [copied, color.onBrand],
    );

    if (!translation && !isTranslating) return null;

    return (
      <Animated.View
        layout={LinearTransition.springify()}
        style={{
          borderRadius: borderRadius["2xl"],
          borderCurve: "continuous",
          padding: spacing.lg,
          boxShadow: shadows.soft,
          backgroundColor: color.brand,
        }}
      >
        {isTranslating ? (
          <Box>
            <Box style={{ gap: spacing.md }}>
              <SkeletonBox width="85%" height={20} borderRadius={6} />
              <SkeletonBox width="60%" height={20} borderRadius={6} />
              <SkeletonBox width="40%" height={20} borderRadius={6} />
            </Box>
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: spacing.md,
                marginTop: spacing.xl,
              }}
            >
              <Box style={{ alignItems: "center", gap: spacing.sm }}>
                <SkeletonBox width={64} height={64} borderRadius={32} />
                <SkeletonBox width={40} height={12} />
              </Box>
              {onCopy ? (
                <Box style={{ alignItems: "center", gap: spacing.sm }}>
                  <SkeletonBox width={64} height={64} borderRadius={32} />
                  <SkeletonBox width={36} height={12} />
                </Box>
              ) : null}
            </Box>
          </Box>
        ) : (
          <>
            <ScrollArea>
              <Text
                variant="bodyLarge"
                selectable
                style={{ color: color.onBrand }}
              >
                {translation}
              </Text>
              {!!transliteration && (
                <Transliteration text={transliteration} tone="brand" />
              )}
            </ScrollArea>
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: spacing.md,
                marginTop: spacing.xl,
              }}
            >
              <Box style={{ alignItems: "center", gap: spacing.sm }}>
                <IconButton
                  accessibilityLabel={
                    isSpeaking ? "Stop speaking" : "Listen to translation"
                  }
                  onPress={handleSpeakToggle}
                  backgroundColor={
                    isSpeaking ? color.onBrand : withAlpha(color.onBrand, 0.2)
                  }
                  icon={
                    isSpeechLoading ? (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <Spinner
                          size="sm"
                          color={isSpeaking ? color.brand : color.onBrand}
                        />
                      </Animated.View>
                    ) : isSpeaking ? (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <VolumeX
                          size={24}
                          color={color.brand}
                          strokeWidth={2.5}
                        />
                      </Animated.View>
                    ) : (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <Volume2
                          size={24}
                          color={color.onBrand}
                          strokeWidth={2.5}
                        />
                      </Animated.View>
                    )
                  }
                />
                <Text variant="caption" style={listenLabelStyle}>
                  {isSpeaking ? "Stop" : "Listen"}
                </Text>
              </Box>

              {onCopy ? (
                <Box style={{ alignItems: "center", gap: spacing.sm }}>
                  <IconButton
                    accessibilityLabel={copied ? "Copied" : "Copy translation"}
                    onPress={onCopy}
                    onLongPress={async () => {
                      if (translation) {
                        track(AnalyticsEvents.RESULT_SHARED, {
                          source: "home",
                        });
                        await Share.share({ message: translation });
                      }
                    }}
                    backgroundColor={
                      copied ? color.onBrand : withAlpha(color.onBrand, 0.2)
                    }
                    icon={
                      copied ? (
                        <Animated.View
                          entering={FadeIn.duration(200)}
                          exiting={FadeOut.duration(200)}
                        >
                          <Check
                            size={24}
                            color={color.brand}
                            strokeWidth={3}
                          />
                        </Animated.View>
                      ) : (
                        <Animated.View
                          entering={FadeIn.duration(200)}
                          exiting={FadeOut.duration(200)}
                        >
                          <Copy
                            size={24}
                            color={color.onBrand}
                            strokeWidth={2.5}
                          />
                        </Animated.View>
                      )
                    }
                  />
                  <Text variant="caption" style={copyLabelStyle}>
                    {copied ? "Copied" : "Copy"}
                  </Text>
                </Box>
              ) : null}
            </Box>
          </>
        )}
      </Animated.View>
    );
  },
);
