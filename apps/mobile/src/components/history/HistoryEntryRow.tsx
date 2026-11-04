import * as Haptics from "expo-haptics";
import Copy from "lucide-react-native/icons/copy";
import Languages from "lucide-react-native/icons/languages";
import ShareIcon from "lucide-react-native/icons/share";
import Trash2 from "lucide-react-native/icons/trash";
import React, { useCallback, useState } from "react";
import { StyleSheet, ViewStyle } from "react-native";

import { HistoryItem } from "@/components/history/HistoryItem";
import { Box, Pressable, Text } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { getLanguageName } from "@/constants/languages";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { CopyService } from "@/services/copyOutService";
import { ShareOutService } from "@/services/shareOutService";
import { HistoryEntry } from "@/store";
import { withAlpha } from "@/utils/color";
import { originProvenanceLabel } from "@/utils/historyOrigin";
import { triggerHaptic } from "@/utils/haptics";
import { AppAlert, AppToast } from "@/utils";

export interface HistoryEntryRowProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;

  onDelete: (entryId: string) => void;
  style?: ViewStyle;
}

interface HistoryActionRowProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

const HistoryActionRow = React.memo(function HistoryActionRow({
  icon,
  label,
  onPress,
  destructive = false,
}: HistoryActionRowProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      feedback="none"
      style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.7 }]}
    >
      <Box
        style={[
          styles.actionIcon,
          {
            backgroundColor: withAlpha(
              destructive ? color.error : color.foreground,
              0.08,
            ),
          },
        ]}
      >
        {icon}
      </Box>
      <Text
        variant="body"
        style={{ color: destructive ? color.error : color.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
});

export const HistoryEntryRow = React.memo(
  function HistoryEntryRow({
    entry,
    onPress,
    onDelete,
    style,
  }: HistoryEntryRowProps): React.ReactElement {
    const { color } = useTheme();
    const [sheetVisible, setSheetVisible] = useState(false);

    const handleDelete = useCallback((): void => {
      AppAlert.confirm(
        "Delete Entry",
        "Are you sure you want to delete this transcript from your history?",
        () => {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          onDelete(entry.id);
        },
      );
    }, [entry.id, onDelete]);

    const handleLongPress = useCallback((): void => {
      setSheetVisible(true);
    }, []);

    const closeSheet = useCallback((): void => {
      setSheetVisible(false);
    }, []);

    const handleCopyText = useCallback((): void => {
      const text = entry.transcript?.trim();
      if (!text) return;
      setSheetVisible(false);
      triggerHaptic("selection");
      void CopyService.copyText(text).then((copied) => {
        if (copied) {
          AppToast.info("Text copied to clipboard", { haptics: false });
        } else {
          AppToast.error("Copy failed");
        }
      });
    }, [entry.transcript]);

    const handleCopyTranslation = useCallback((): void => {
      const text = entry.translation?.trim();
      if (!text) return;
      setSheetVisible(false);
      triggerHaptic("selection");
      void CopyService.copyText(text).then((copied) => {
        if (copied) {
          AppToast.info("Translation copied to clipboard", { haptics: false });
        } else {
          AppToast.error("Copy failed");
        }
      });
    }, [entry.translation]);

    const handleShare = useCallback((): void => {
      const parts = [
        entry.transcript?.trim(),
        entry.translation?.trim(),
      ].filter((part): part is string => !!part);
      setSheetVisible(false);
      // No audio here: History stores text only, by design. The service still
      // applies the share signature these two paths were skipping.
      void ShareOutService.shareArtifact(
        null,
        parts.join("\n\n") || null,
        "history",
      );
    }, [entry.transcript, entry.translation]);

    const handleSheetDelete = useCallback((): void => {
      setSheetVisible(false);
      handleDelete();
    }, [handleDelete]);

    const hasTranslation =
      !!entry.translation?.trim() &&
      entry.translation.trim() !== entry.transcript?.trim();

    // Lead with provenance. The language pair alone doesn't tell you which
    // surface produced the note, which is usually the thing you want to know
    // when you are about to act on it.
    const sourceName = getLanguageName(entry.sourceLang || "en");
    const targetName = entry.targetLang
      ? getLanguageName(entry.targetLang)
      : null;
    const langDisplay =
      hasTranslation && targetName
        ? `${sourceName} → ${targetName}`
        : sourceName;
    const sheetTitle = `${originProvenanceLabel(entry)} · ${langDisplay}`;

    return (
      <>
        <HistoryItem
          entry={entry}
          onPress={onPress}
          onDelete={handleDelete}
          onLongPress={handleLongPress}
          style={style}
        />

        <Sheet visible={sheetVisible} onClose={closeSheet} title={sheetTitle}>
          <Box style={styles.sheetContent}>
            {!!entry.transcript?.trim() && (
              <HistoryActionRow
                icon={<Copy size={iconSize.sm} color={color.foreground} />}
                label="Copy text"
                onPress={handleCopyText}
              />
            )}
            {hasTranslation && (
              <HistoryActionRow
                icon={<Languages size={iconSize.sm} color={color.brand} />}
                label="Copy translation"
                onPress={handleCopyTranslation}
              />
            )}
            <HistoryActionRow
              icon={<ShareIcon size={iconSize.sm} color={color.foreground} />}
              label="Share"
              onPress={handleShare}
            />
            <HistoryActionRow
              icon={<Trash2 size={iconSize.sm} color={color.error} />}
              label="Delete entry"
              destructive
              onPress={handleSheetDelete}
            />
          </Box>
        </Sheet>
      </>
    );
  },
  (prev, next) =>
    prev.entry === next.entry &&
    prev.onPress === next.onPress &&
    prev.onDelete === next.onDelete &&
    prev.style === next.style,
);

const styles = StyleSheet.create({
  sheetContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    minHeight: 52,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
