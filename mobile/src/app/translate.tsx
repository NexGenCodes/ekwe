import { useSelector } from "@legendapp/state/react";
import { BlurView } from "expo-blur";
import { useLocalSearchParams } from "expo-router";
import { ChevronDown, ArrowDownUp } from "lucide-react-native";
import React, { useState, useRef } from "react";

import { LanguagePickerSheet, Button, Card } from "@/components";
import { Box, Text, ScrollArea, Spinner, Pressable } from "@/components/ui";
import { getLanguageName, FLAG_MAP } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTranslation, useClipboard, useTheme } from "@/hooks";
import { HistoryService } from "@/services/HistoryService";
import { settings$, settingsActions, auth$ } from "@/store";
import { AppToast, isIOS } from "@/utils";

export default function TranslateScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const { text, detectedLang = "und" } = params;

  // Store & Settings
  const userSession = useSelector(() => auth$.session.get());
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const pinnedLanguages = useSelector(() => settings$.pinnedLanguages.get());
  const { setPinnedLanguages } = settingsActions;

  const { color, isDark } = useTheme();
  const primaryColor = color.foreground;
  const mutedColor = color.muted;
  const { copied, copy } = useClipboard();
  const { translate } = useTranslation();

  const translateAbortRef = useRef<AbortController | null>(null);

  // Local State
  const [sourceLang, setSourceLang] = useState<string>(
    (detectedLang as string) !== "und" ? (detectedLang as string) : "en",
  );
  const [targetLang, setTargetLang] = useState<string>(
    defaultTargetLang || "es",
  );

  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // Language Picker State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<"source" | "target">("source");

  const openPicker = (mode: "source" | "target"): void => {
    setPickerMode(mode);
    setPickerVisible(true);
  };

  const handleLanguageSelect = (
    selectedCodes: string[],
    newPinned: string[],
  ): void => {
    if (selectedCodes.length > 0) {
      const selected = selectedCodes[selectedCodes.length - 1];
      if (pickerMode === "source") {
        setSourceLang(selected);
        setTranslation(null);
      } else {
        setTargetLang(selected);
        setTranslation(null);
      }
    }
    setPinnedLanguages(newPinned);
    setPickerVisible(false);
  };

  const handleTranslate = async (): Promise<void> => {
    if (!text) return;
    translateAbortRef.current?.abort();
    const controller = new AbortController();
    translateAbortRef.current = controller;
    setIsTranslating(true);
    try {
      const result = await translate(
        text as string,
        sourceLang,
        targetLang,
        controller.signal,
      );

      if (controller.signal.aborted) return;

      if (!result.ok) {
        throw new Error(result.error);
      }

      const translationText = result.value.translation;
      setTranslation(translationText);

      // Save to history via HistoryService
      await HistoryService.recordTranslation(
        {
          sourceLang,
          targetLang,
          transcript: text as string,
          translation: translationText,
          transliteration: null,
          duration: 0,
          sourceApp: "shared-text",
          provider: "gemini",
        },
        userSession,
      );
    } catch (error) {
      AppToast.error("Translation Failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async (copyText: string): Promise<void> => {
    await copy(copyText);
    AppToast.success("Text copied to clipboard");
  };

  const handleSwap = (): void => {
    if (sourceLang === "auto" || targetLang === "" || targetLang === "none")
      return;
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setTranslation(null);
  };

  const Container = isIOS ? BlurView : Box;
  const containerProps = isIOS
    ? { intensity: 80, tint: isDark ? ("dark" as const) : ("light" as const) }
    : { style: { flex: 1, backgroundColor: color.background } };

  return (
    <Container {...containerProps} style={styles.flex1}>
      <ScrollArea
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: spacing["2xl"] }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Box style={styles.mainContainer}>
          {/* Source Text Context */}
          <Box style={styles.block}>
            <Box style={styles.blockHeader}>
              <Pressable
                onPress={() => openPicker("source")}
                style={styles.pickerTrigger}
              >
                <Text
                  variant="caption"
                  style={{
                    textTransform: "uppercase",
                    marginRight: spacing.xs,
                    color: color.muted,
                  }}
                >
                  {(detectedLang as string) !== "und" &&
                  sourceLang === (detectedLang as string)
                    ? "DETECTED · "
                    : "SOURCE · "}
                  {getLanguageName(sourceLang)} {FLAG_MAP[sourceLang] || ""}
                </Text>
                <ChevronDown size={14} color={mutedColor} />
              </Pressable>
            </Box>
            <Card
              style={{ padding: spacing.lg, borderRadius: borderRadius["2xl"] }}
            >
              <Text variant="bodyLarge" style={{ color: color.foreground }}>
                {text}
              </Text>
            </Card>
          </Box>

          {/* Divider & Target Language Selector */}
          <Box style={styles.controlsRow}>
            <Pressable
              onPress={handleSwap}
              style={[
                styles.swapButton,
                { backgroundColor: color.card, borderColor: color.border },
              ]}
            >
              <ArrowDownUp size={20} color={mutedColor} />
            </Pressable>

            <Box style={[styles.divider, { backgroundColor: color.border }]} />

            <Pressable
              onPress={() => openPicker("target")}
              style={[
                styles.targetPickerButton,
                { backgroundColor: color.card, borderColor: color.border },
              ]}
            >
              <Text
                variant="body"
                style={{ marginRight: spacing.sm, color: color.foreground }}
              >
                {getLanguageName(targetLang)} {FLAG_MAP[targetLang] || ""}
              </Text>
              <ChevronDown size={16} color={mutedColor} />
            </Pressable>
          </Box>

          {/* Translation Result or Translate Button */}
          {translation ? (
            <Box style={styles.resultBlock}>
              <Box style={styles.blockHeader}>
                <Text
                  variant="caption"
                  style={{ textTransform: "uppercase", color: primaryColor }}
                >
                  TRANSLATED · {getLanguageName(targetLang)}
                </Text>
              </Box>
              <Card
                variant="accent"
                style={{
                  padding: spacing.lg,
                  borderRadius: borderRadius["2xl"],
                }}
              >
                <Text variant="bodyLarge" style={{ color: color.foreground }}>
                  {translation}
                </Text>
              </Card>
            </Box>
          ) : (
            <Box style={styles.translateActionContainer}>
              {isTranslating ? (
                <Spinner size="lg" />
              ) : (
                <Button
                  variant="primary"
                  size="large"
                  label={`Translate to ${getLanguageName(targetLang)}`}
                  onPress={handleTranslate}
                  style={styles.translateButton}
                />
              )}
            </Box>
          )}
        </Box>
      </ScrollArea>

      {/* Global Action Bar */}
      {!isTranslating && translation && (
        <Box
          style={[
            styles.actionBar,
            { borderTopColor: color.border, backgroundColor: color.background },
          ]}
        >
          <Button
            variant="outline"
            size="large"
            label={copied ? "Copied" : "Copy Full Translation"}
            onPress={() => handleCopy(`${text}\n\n---\n\n${translation}`)}
          />
        </Box>
      )}

      {/* Reusable Language Picker */}
      <LanguagePickerSheet
        isVisible={pickerVisible}
        selectedLanguages={
          pickerMode === "source" ? [sourceLang] : [targetLang]
        }
        pinnedLanguages={pinnedLanguages}
        onSelectionChange={handleLanguageSelect}
        onClose={() => setPickerVisible(false)}
      />
    </Container>
  );
}

const styles = {
  flex1: { flex: 1 } as const,
  scrollView: { flex: 1, paddingHorizontal: spacing.lg } as const,
  mainContainer: { marginTop: spacing.xl } as const,
  block: { marginBottom: spacing.md } as const,
  blockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  } as const,
  pickerTrigger: { flexDirection: "row", alignItems: "center" } as const,
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  } as const,
  swapButton: {
    padding: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  } as const,
  divider: { flex: 1, height: 1, marginHorizontal: spacing.md } as const,
  targetPickerButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  } as const,
  resultBlock: { marginTop: spacing.sm, marginBottom: spacing.xl } as const,
  translateActionContainer: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
  } as const,
  translateButton: { width: "100%", maxWidth: 280 } as const,
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
  } as const,
};
