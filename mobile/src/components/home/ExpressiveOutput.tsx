import { useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import { Copy, Volume2, VolumeX, Check } from "lucide-react-native";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Share } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

import { IconButton } from "../IconButton";
import { SkeletonBox } from "../SkeletonBox";

import { Box, Text, Spinner, ScrollArea } from "@/components/ui";
import { shadows } from "@/constants/shadows";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import logger from "@/utils/logger";

interface ExpressiveOutputProps {
  translation: string | null;
  isTranslating: boolean;
  copied: boolean;
  onCopy?: () => void;
  targetLang?: string;
  transliteration?: string | null;
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

    // Stop speech when translation changes (e.g. new dictation result)
    useEffect(() => {
      if (isSpeaking || isTTSLoading) {
        Speech.stop();
        setIsSpeaking(false);
        setIsTTSLoading(false);
      }
      // Only react to translation changes, not isSpeaking changes
    }, [translation]);

    // Stop speech when the user navigates away from the screen
    useFocusEffect(
      useCallback((): (() => void) => {
        return (): void => {
          Speech.stop();
          setIsSpeaking(false);
          setIsTTSLoading(false);
        };
      }, []),
    );

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isTTSLoading) return; // Prevent spam clicking while loading

      if (isSpeaking) {
        try {
          await Speech.stop();
        } catch (err) {
          // ignore stop errors
          logger.warn("Speech.stop failed", err);
        }
        setIsSpeaking(false);
        setIsTTSLoading(false);
        return;
      }

      if (translation && targetLang) {
        // Ensure any existing speech is stopped before starting a new one
        try {
          await Speech.stop();
        } catch (err) {
          logger.warn("Speech.stop failed", err);
        }

        setIsTTSLoading(true);
        try {
          Speech.speak(translation, {
            language: targetLang,
            onStart: (): void => {
              setIsTTSLoading(false);
              setIsSpeaking(true);
            },
            onDone: (): void => {
              setIsSpeaking(false);
              setIsTTSLoading(false);
            },
            onError: (e): void => {
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

              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { AppToast } = require("@/utils");
              AppToast.error("Speech Unavailable", {
                description:
                  "Your device does not support text-to-speech for this language, or the voice is not downloaded.",
              });
            },
            onStopped: (): void => {
              setIsSpeaking(false);
              setIsTTSLoading(false);
            },
          });
        } catch (err) {
          setIsSpeaking(false);
          setIsTTSLoading(false);
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.warn("Speech.speak threw exception:", errorMsg);

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { AppToast } = require("@/utils");
          AppToast.error("Speech Unavailable", {
            description:
              "Your device does not support text-to-speech for this language.",
          });
        }
      }
    }, [isSpeaking, isTTSLoading, translation, targetLang]);

    const transliterationStyle = useMemo(
      () => ({ paddingTop: spacing.sm, color: `${color.onBrand}CC` }),
      [color.onBrand],
    );

    const listenLabelStyle = useMemo(
      () => ({
        color: isSpeaking ? color.onBrand : `${color.onBrand}CC`,
      }),
      [isSpeaking, color.onBrand],
    );

    const copyLabelStyle = useMemo(
      () => ({
        color: copied ? color.onBrand : `${color.onBrand}CC`,
      }),
      [copied, color.onBrand],
    );

    if (!translation && !isTranslating) return null;

    return (
      <Animated.View
        layout={LinearTransition.springify()}
        style={{
          borderRadius: borderRadius["2xl"],
          padding: spacing.lg,
          ...shadows.soft,
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
                <Text variant="body" style={transliterationStyle} selectable>
                  {transliteration}
                </Text>
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
                    isSpeaking ? color.onBrand : `${color.onBrand}33`
                  }
                  icon={
                    isTTSLoading ? (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <Spinner
                          size="sm"
                          color={
                            isSpeaking ? color.brand : color.onBrand
                          }
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
                      copied ? color.onBrand : `${color.onBrand}33`
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
