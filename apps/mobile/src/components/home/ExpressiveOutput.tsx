import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import { useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import Copy from "lucide-react-native/icons/copy";
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import Check from "lucide-react-native/icons/check";
import { useSelector } from "@legendapp/state/react";
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

import { IconButton } from "../IconButton";
import { SkeletonBox } from "../SkeletonBox";
import { Transliteration } from "../Transliteration";

import { claimTtsFocus, releaseTtsFocus } from "@/hooks/audio/audioFocus";

import { Box, Text, Spinner, ScrollArea } from "@/components/ui";
import { shadows } from "@/constants/shadows";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { synthesizeSpeech } from "@/services/tts";
import { auth$ } from "@/store";
import { cleanEchoCache } from "@/utils/echo";
import { withAlpha } from "@/utils/color";
import logger from "@/utils/logger";

export interface ExpressiveOutputProps {
  translation: string | null;
  isTranslating: boolean;
  copied: boolean;
  onCopy?: () => void;
  targetLang?: string;
  transliteration?: string | null;
}

type Voice = Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>>[number];

// Voices don't change during a session, and on iOS the first call can return
// [] until the speech engine initializes, so cache the last known non-empty
// result and reuse the in-flight promise to avoid refetch churn.
let cachedVoices: Voice[] = [];
let voiceLoadPromise: Promise<Voice[]> | null = null;

function loadVoices(): Promise<Voice[]> {
  voiceLoadPromise ??= Speech.getAvailableVoicesAsync()
    .then((voices) => {
      if (voices.length > 0) cachedVoices = voices;
      return cachedVoices;
    })
    .catch(() => cachedVoices);
  return voiceLoadPromise;
}

/**
 * Resolves once the native player reports a source is loaded, so the cloud
 * TTS path only marks itself as "speaking" when audio will actually come out.
 */
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
    const [isTTSLoading, setIsTTSLoading] = useState(false);
    const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);

    // Cloud TTS is a premium perk: when it works it plays a downloaded audio
    // file through expo-audio; on any failure we fall back to on-device speech.
    const isPro = useSelector(() => auth$.isPro.get());

    // Cloud-TTS lifecycle (pro users): the in-flight synthesize request and the
    // active expo-audio player + its temp audio file. Every teardown path (stop
    // tap, blur, translation change, focus steal) funnels through stopPlayback()
    // so the two never race and temp files never leak.
    const ttsAbortRef = useRef<AbortController | null>(null);
    const ttsPlayerRef = useRef<{ player: AudioPlayer; uri: string } | null>(
      null,
    );
    // Bumped on every stop; lets the async toggle detect that it was
    // superseded mid-flight (e.g. blur while cloud synthesis was loading).
    const stopRequestedRef = useRef(0);

    const stopPlayback = useCallback((): void => {
      stopRequestedRef.current += 1;
      const controller = ttsAbortRef.current;
      if (controller) {
        ttsAbortRef.current = null;
        controller.abort();
      }
      Speech.stop().catch(() => {});
      const active = ttsPlayerRef.current;
      if (active) {
        ttsPlayerRef.current = null;
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
      releaseTtsFocus();
      setIsSpeaking(false);
      setIsTTSLoading(false);
    }, [stopPlayback]);

    // Tries cloud synthesis and plays the result. Returns true only when cloud
    // audio actually started; any failure returns false so the caller can fall
    // back to on-device speech.
    const startCloudTts = useCallback(
      async (text: string, lang: string): Promise<boolean> => {
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        claimTtsFocus(stopAllPlayback);
        setIsTTSLoading(true);

        try {
          const result = await synthesizeSpeech(text, lang, controller.signal);
          if (controller.signal.aborted) return false;
          if (!result.ok) {
            logger.warn(
              "[ExpressiveOutput] Cloud TTS unavailable, falling back to device:",
              result.error,
            );
            return false;
          }

          const player = createAudioPlayer(result.value.uri);
          ttsPlayerRef.current = { player, uri: result.value.uri };
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
              logger.warn("[ExpressiveOutput] Cloud TTS audio failed to load");
            }
            return false;
          }

          setIsTTSLoading(false);
          setIsSpeaking(true);
          return true;
        } catch (err) {
          logger.warn("[ExpressiveOutput] Cloud TTS threw, falling back:", err);
          return false;
        }
      },
      [stopAllPlayback],
    );

    useEffect(() => {
      let active = true;
      loadVoices().then((voices) => {
        if (active) setAvailableVoices(voices);
      });
      return (): void => {
        active = false;
      };
    }, []);

    // Only treat a non-empty voice list as authoritative: an empty result can
    // just mean the speech engine hasn't warmed up yet, in which case the
    // existing speak-time error path still covers the user.
    const voiceUnavailable = useMemo((): boolean => {
      if (availableVoices.length === 0 || !targetLang) return false;
      const langCode = targetLang.split("-")[0].toLowerCase();
      return !availableVoices.some((voice) =>
        voice.language?.toLowerCase().startsWith(langCode),
      );
    }, [availableVoices, targetLang]);

    // Stop speech when translation changes (e.g. new dictation result)
    useEffect(() => {
      if (isSpeaking || isTTSLoading) {
        stopAllPlayback();
      }
      // Only react to translation changes, not isSpeaking changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [translation]);

    // Stop speech when the user navigates away from the screen
    useFocusEffect(
      useCallback((): (() => void) => {
        return (): void => {
          stopAllPlayback();
        };
      }, [stopAllPlayback]),
    );

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isTTSLoading) return; // Prevent spam clicking while loading

      if (isSpeaking) {
        stopAllPlayback();
        return;
      }

      if (!translation || !targetLang) return;

      // Stop any in-flight/playing audio before starting (idempotent).
      stopPlayback();

      // Premium users get the cloud TTS pipeline (natural voices in every
      // supported language); on any failure we fall through to the on-device
      // voice so Listen always works.
      if (isPro) {
        const stopEpoch = stopRequestedRef.current;
        const started = await startCloudTts(translation, targetLang);
        if (started) return;
        // A stop (blur, translation change) superseded us mid-load — don't
        // start device speech on stale input.
        if (stopRequestedRef.current !== stopEpoch) return;
        // Cloud failed — clear the loading flag before falling through (the
        // device path re-raises it, and the voiceUnavailable branch below must
        // not leave the button spinning).
        setIsTTSLoading(false);
      }

      if (voiceUnavailable) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AppToast } = require("@/utils");
        AppToast.error("No Voice Installed", {
          description:
            "Your device has no text-to-speech voice for this language. Add one in your device's Settings (Accessibility > Spoken Content on iOS, Language & input on Android).",
        });
        return;
      }

      // Ensure any existing speech is stopped before starting a new one
      try {
        await Speech.stop();
      } catch (err) {
        logger.warn("Speech.stop failed", err);
      }

      setIsTTSLoading(true);
      claimTtsFocus(stopAllPlayback);
      try {
        Speech.speak(translation, {
          language: targetLang,
          onStart: (): void => {
            setIsTTSLoading(false);
            setIsSpeaking(true);
          },
          onDone: (): void => {
            releaseTtsFocus();
            setIsSpeaking(false);
            setIsTTSLoading(false);
          },
          onError: (e): void => {
            releaseTtsFocus();
            setIsSpeaking(false);
            setIsTTSLoading(false);

            const errorMsg = e instanceof Error ? e.message : String(e);
            logger.warn("Speech.speak error:", errorMsg);

            // Ignore interruption errors (which happen naturally on stop)
            if (
              errorMsg.includes("interrupted") ||
              errorMsg.includes("stopped")
            ) {
              return;
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { AppToast } = require("@/utils");
            AppToast.error("Speech Unavailable", {
              description:
                "Your device does not support text-to-speech for this language, or the voice is not downloaded.",
            });
          },
          onStopped: (): void => {
            releaseTtsFocus();
            setIsSpeaking(false);
            setIsTTSLoading(false);
          },
        });
      } catch (err) {
        releaseTtsFocus();
        setIsSpeaking(false);
        setIsTTSLoading(false);
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn("Speech.speak threw exception:", errorMsg);

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AppToast } = require("@/utils");
        AppToast.error("Speech Unavailable", {
          description:
            "Your device does not support text-to-speech for this language.",
        });
      }
    }, [
      isSpeaking,
      isTTSLoading,
      translation,
      targetLang,
      voiceUnavailable,
      isPro,
      startCloudTts,
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
                    isTTSLoading ? (
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
