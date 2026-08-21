import { useSelector } from "@legendapp/state/react";
import { BlurView } from "expo-blur";
import { useLocalSearchParams } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ArrowDownUp from "lucide-react-native/icons/arrow-down-up";
import React, { useEffect, useState, useRef } from "react";

import {
  LanguagePickerSheet,
  Button,
  Card,
  Transliteration,
} from "@/components";
import { Box, Text, ScrollArea, Spinner, Pressable } from "@/components/ui";
import { getLanguageName, getLanguageFlag } from "@/constants/languages";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTranslation, useClipboard, useTheme } from "@/hooks";
import { HistoryService } from "@/services/HistoryService";
import { settings$, auth$ } from "@/store";
import { AppToast, isIOS } from "@/utils";
import { EkweError, ErrorMessages } from "@/constants/errors";

export default function TranslateScreen(): React.JSX.Element {
  const params = useLocalSearchParams();
  const { text, detectedLang = "und" } = params;

  // Store & Settings
  const userSession = useSelector(() => auth$.session.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());

  const { color, isDark } = useTheme();
  const primaryColor = color.foreground;
  const mutedColor = color.muted;
  const { copied, copy } = useClipboard();
  const { translate } = useTranslation();

  const translateAbortRef = useRef<AbortController | null>(null);

  const paramDetected = (detectedLang as string) !== "und";

  // Local State
  const [sourceLang, setSourceLang] = useState<string>(
    paramDetected ? (detectedLang as string) : "en",
  );
  const shownDetected =
    paramDetected && isPro && sourceLang === (detectedLang as string);
  const [targetLang, setTargetLang] = useState<string>(
    defaultTargetLang || "es",
  );

  const [translation, setTranslation] = useState<string | null>(null);
  const [transliteration, setTransliteration] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const autoCopy = useSelector(() => settings$.autoCopy.get());
  const lastAutoCopiedRef = useRef<string | null>(null);

  // Auto-copy completed translations when the profile toggle is on. Fires once
  // per unique translation value (reset whenever the result clears) so toggling
  // the switch mid-session never re-copies the text already on screen.
  useEffect(() => {
    if (isTranslating || !translation) {
      if (!translation) lastAutoCopiedRef.current = null;
      return;
    }
    if (!autoCopy) return;
    if (lastAutoCopiedRef.current === translation) return;
    lastAutoCopiedRef.current = translation;
    void copy(translation);
  }, [autoCopy, isTranslating, translation, copy]);

  // Language Picker State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<"source" | "target">("source");

  const openPicker = (mode: "source" | "target"): void => {
    setPickerMode(mode);
    setPickerVisible(true);
  };

  const handleLanguageSelect = (selectedCodes: string[]): void => {
    if (selectedCodes.length > 0) {
      const selected = selectedCodes[selectedCodes.length - 1];
      if (pickerMode === "source") {
        setSourceLang(selected);
        setTranslation(null);
        setTransliteration(null);
      } else {
        setTargetLang(selected);
        setTranslation(null);
        setTransliteration(null);
      }
    }
    setPickerVisible(false);
  };

  const handleTranslate = async (): Promise<void> => {
    if (!text) return;
    if (sourceLang === targetLang) {
      AppToast.info(
        "Source and target languages are the same. Change one to translate.",
      );
      return;
    }
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
      setTransliteration(result.value.transliteration ?? null);

      // Save to history via HistoryService
      await HistoryService.recordTranslation(
        {
          sourceLang,
          targetLang,
          transcript: text as string,
          translation: translationText,
          transliteration: result.value.transliteration ?? null,
          duration: 0,
          sourceApp: "shared-text",
          provider: "gemini",
          type: "translation",
        },
        userSession,
      );
    } catch (error) {
      const code =
        error instanceof Error ? (error.message as EkweError) : undefined;
      AppToast.error("Translation Failed", {
        description:
          code && ErrorMessages[code]
            ? ErrorMessages[code]
            : "Something went wrong. Please try again.",
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async (copyText: string): Promise<void> => {
    await copy(copyText);
  };

  const handleSwap = (): void => {
    if (
      sourceLang === "auto" ||
      targetLang === "" ||
      targetLang === "none" ||
      sourceLang === targetLang
    )
      return;
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setTranslation(null);
    setTransliteration(null);
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
                  {shownDetected ? "DETECTED · " : "SOURCE · "}
                  {getLanguageName(sourceLang)} {getLanguageFlag(sourceLang)}
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
                {getLanguageName(targetLang)} {getLanguageFlag(targetLang)}
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
                {!!transliteration && (
                  <Transliteration text={transliteration} />
                )}
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
