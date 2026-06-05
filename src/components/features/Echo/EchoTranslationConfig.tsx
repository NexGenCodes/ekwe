import {
  Zap,
  AlertCircle,
  ArrowRight,
  Ear,
  Languages,
} from "lucide-react-native";
import React from "react";
import { ScrollView } from "react-native";

import { AnimatedCopyButton } from "../../AnimatedCopyButton";
import { ScrollableTextBox } from "../../ScrollableTextBox";

import { Box, Text, Pressable } from "@/components/ui";
import { LANGUAGES, FLAG_MAP } from "@/constants/languages";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface EchoTranslationConfigProps {
  step: "TranscribeResult";
  selectedLang: string;
  detectedLang: string | null;
  targetLang: string;
  transcription: string | null;
  availableTargetList: typeof LANGUAGES;
  isDark: boolean;
  setTargetLang: (code: string) => void;
  handleTranslate: () => void;
}

export const EchoTranslationConfig: React.FC<EchoTranslationConfigProps> =
  React.memo(
    ({
      step,
      selectedLang,
      detectedLang,
      targetLang,
      transcription,
      availableTargetList,
      setTargetLang,
      handleTranslate,
    }) => {
      const { color } = useTheme();
      const brandPrimary = color.secondary;
      const brandWarning = color.warning;

      const isMismatch =
        selectedLang !== "auto" && selectedLang !== detectedLang;

      const selectedName =
        selectedLang === "auto"
          ? "Auto"
          : (LANGUAGES.find((l) => l.code === selectedLang)?.englishName ??
            selectedLang);
      const detectedName =
        LANGUAGES.find((l) => l.code === detectedLang)?.englishName ??
        detectedLang ??
        "—";
      const selectedFlag = FLAG_MAP[selectedLang] || "🌐";
      const detectedFlag = detectedLang ? FLAG_MAP[detectedLang] || "🌐" : "🌐";

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
                  paddingVertical: spacing.sm,
                  borderRadius: borderRadius.xl,
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
                <Box>
                  <Text
                    variant="caption"
                    style={{
                      marginBottom: 4,
                      color: isMismatch ? brandWarning : color.muted,
                    }}
                  >
                    Selected
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color: isMismatch ? brandWarning : color.primary,
                    }}
                  >
                    {selectedName}
                  </Text>
                </Box>
              </Box>

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
                  paddingVertical: spacing.sm,
                  borderRadius: borderRadius.xl,
                  borderWidth: 1,
                  gap: spacing.sm,
                  backgroundColor: color.surface,
                  borderColor: color.border,
                }}
              >
                <Ear size={13} color={brandPrimary} />
                <Text variant="body">{detectedFlag}</Text>
                <Box>
                  <Text
                    variant="caption"
                    style={{ marginBottom: 4, color: color.muted }}
                  >
                    Detected
                  </Text>
                  <Text variant="bodySmall" style={{ color: color.primary }}>
                    {detectedName}
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>

          <ScrollableTextBox
            text={transcription}
            height={280}
            variant="default"
          />

          <Box>
            <Text
              variant="body"
              style={{ marginBottom: spacing.md, color: color.foreground }}
            >
              Translate to:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: spacing.lg }}
            >
              {availableTargetList.map((lang) => (
                <Pressable
                  key={lang.code}
                  feedback="opacity"
                  onPress={() => setTargetLang(lang.code)}
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
                  <Text variant="body">{FLAG_MAP[lang.code] || "🌐"}</Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color:
                        targetLang === lang.code
                          ? color.onSecondary
                          : color.primary,
                    }}
                  >
                    {lang.englishName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Box style={{ flexDirection: "row", gap: spacing.md }}>
              <AnimatedCopyButton
                textToCopy={transcription!}
                size={16}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.sm,
                  paddingVertical: spacing.md,
                  borderWidth: 1,
                  borderRadius: borderRadius.xl,
                  borderColor: color.border,
                }}
              >
                <Text variant="bodySmall" style={{ color: color.primary }}>
                  Copy
                </Text>
              </AnimatedCopyButton>
              <Pressable
                feedback="opacity"
                onPress={handleTranslate}
                disabled={!targetLang}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.sm,
                  paddingVertical: spacing.md,
                  borderWidth: 1,
                  borderRadius: borderRadius.xl,
                  backgroundColor: brandPrimary,
                  opacity: targetLang ? 1 : opacity.disabled,
                }}
              >
                <Zap size={16} color={color.onSecondary} />
                <Text variant="bodySmall" style={{ color: color.onSecondary }}>
                  Translate
                </Text>
              </Pressable>
            </Box>
          </Box>
        </Box>
      );
    },
  );
