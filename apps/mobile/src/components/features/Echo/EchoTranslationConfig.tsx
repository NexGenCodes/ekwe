import Zap from "lucide-react-native/icons/zap";
import AlertCircle from "lucide-react-native/icons/circle-alert";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Ear from "lucide-react-native/icons/ear";
import Languages from "lucide-react-native/icons/languages";
import React from "react";
import {
  Pressable as GHRNPressable,
  ScrollView,
} from "react-native-gesture-handler";

import { TextBox } from "./TextBox";

import type { WaveformPlaybackController } from "@/hooks/audio/useAudioWaveformPlayback";

import { Box, Text, Pressable } from "@/components/ui";
import { LANGUAGES, getLanguageFlag } from "@/constants/languages";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks/ui";

interface EchoTranslationConfigProps {
  step: "TranscribeResult";
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string;
  transcription: string | null;
  availableTargetList: typeof LANGUAGES;
  setTargetLang: (code: string) => void;
  handleTranslate: () => void;
  audioPlayer: WaveformPlaybackController | null;
  autoLanguageDetect: boolean;
}

export const EchoTranslationConfig: React.FC<EchoTranslationConfigProps> =
  React.memo(
    ({
      selectedLang,
      detectedLang,
      autoLanguageDetect,
      targetLang,
      transcription,
      availableTargetList,
      setTargetLang,
      handleTranslate,
      audioPlayer,
    }) => {
      const { color } = useTheme();
      const brandPrimary = color.brand;
      const brandWarning = color.warning;

      const isMismatch =
        autoLanguageDetect &&
        selectedLang !== "auto" &&
        selectedLang !== detectedLang;

      const showsDetection = autoLanguageDetect && !!detectedLang;

      const selectedName =
        selectedLang === "auto"
          ? "Auto"
          : (LANGUAGES.find((l) => l.code === selectedLang)?.englishName ??
            selectedLang);
      const detectedName =
        LANGUAGES.find((l) => l.code === detectedLang)?.englishName ??
        detectedLang ??
        "—";
      const selectedFlag = getLanguageFlag(selectedLang);
      const detectedFlag = detectedLang ? getLanguageFlag(detectedLang) : "🌐";

      return (
        <Box>
          {/* Language Pills */}
          <Box style={{ marginBottom: spacing.md, gap: spacing.sm }}>
            {isMismatch && (
              <Box
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  borderRadius: borderRadius["2xl"],
                  borderWidth: 1,
                  gap: spacing.xs,
                  backgroundColor: color.surface,
                  borderColor: brandWarning,
                }}
              >
                <AlertCircle size={12} color={brandWarning} />
                <Text variant="caption" style={{ color: brandWarning }}>
                  Language mismatch
                </Text>
              </Box>
            )}

            <Box style={{ flexDirection: "row", alignItems: "center" }}>
              {/* Selected pill */}
              <Box
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: borderRadius["2xl"],
                  borderWidth: 1,
                  gap: spacing.sm,
                  backgroundColor: color.surface,
                  borderColor: isMismatch ? brandWarning : color.border,
                }}
              >
                <Languages
                  size={13}
                  color={isMismatch ? brandWarning : brandPrimary}
                />
                <Text variant="body">{selectedFlag}</Text>
                <Text
                  variant="bodySmall"
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: isMismatch ? brandWarning : color.foreground,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{ color: isMismatch ? brandWarning : color.muted }}
                  >
                    {autoLanguageDetect ? "Selected · " : "Transcribed in · "}
                  </Text>
                  {selectedName}
                </Text>
              </Box>

              {showsDetection && (
                <>
                  <ArrowRight
                    size={14}
                    color={color.muted}
                    style={{ marginHorizontal: spacing.xs }}
                  />

                  {/* Detected pill */}
                  <Box
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.xs,
                      borderRadius: borderRadius["2xl"],
                      borderWidth: 1,
                      gap: spacing.sm,
                      backgroundColor: color.surface,
                      borderColor: color.border,
                    }}
                  >
                    <Ear size={13} color={brandPrimary} />
                    <Text variant="body">{detectedFlag}</Text>
                    <Text
                      variant="bodySmall"
                      numberOfLines={1}
                      style={{ flex: 1, color: color.foreground }}
                    >
                      <Text variant="caption" style={{ color: color.muted }}>
                        Detected ·{" "}
                      </Text>
                      {detectedName}
                    </Text>
                  </Box>
                </>
              )}
            </Box>
          </Box>

          <TextBox
            text={transcription}
            height={250}
            lead="Transcription"
            lang={detectedLang}
            showFlag
            withCheck
            audioPlayer={audioPlayer}
          />

          <Box>
            <Text
              variant="body"
              style={{ marginBottom: spacing.md, color: color.foreground }}
            >
              Translate to
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              disableIntervalMomentum
              style={{ marginBottom: spacing.lg }}
            >
              {availableTargetList.map((lang) => (
                <GHRNPressable
                  key={lang.code}
                  onPress={() => setTargetLang(lang.code)}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`Translate to ${lang.englishName}`}
                  accessibilityState={{
                    selected: targetLang === lang.code,
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: 1,
                    borderRadius: borderRadius["2xl"],
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    marginRight: spacing.sm,
                    gap: spacing.sm,
                    backgroundColor:
                      targetLang === lang.code ? brandPrimary : color.surface,
                    borderColor:
                      targetLang === lang.code ? brandPrimary : color.border,
                  }}
                >
                  <Text variant="body">{getLanguageFlag(lang.code)}</Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color:
                        targetLang === lang.code
                          ? color.onBrand
                          : color.foreground,
                    }}
                  >
                    {lang.englishName}
                  </Text>
                </GHRNPressable>
              ))}
            </ScrollView>

            <Pressable
              feedback="opacity"
              onPress={handleTranslate}
              disabled={!targetLang}
              accessibilityRole="button"
              accessibilityLabel="Translate"
              accessibilityState={{ disabled: !targetLang }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingVertical: spacing.md,
                borderRadius: borderRadius.xl,
                backgroundColor: brandPrimary,
                opacity: targetLang ? 1 : opacity.disabled,
              }}
            >
              <Zap size={16} color={color.onBrand} />
              <Text variant="bodySmall" style={{ color: color.onBrand }}>
                Translate
              </Text>
            </Pressable>
          </Box>
        </Box>
      );
    },
  );
