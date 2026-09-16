import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Copy from "lucide-react-native/icons/copy";
import Languages from "lucide-react-native/icons/languages";
import ShareIcon from "lucide-react-native/icons/share";
import Trash2 from "lucide-react-native/icons/trash";
import React, { useCallback, useState } from "react";
import { Share, StyleSheet, ViewStyle } from "react-native";

import { HistoryItem } from "./HistoryItem";
import { Box, Pressable, Text } from "@/components/ui";
import { Sheet } from "@/components/ui/Sheet";
import { getLanguageName } from "@/constants/languages";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { HistoryEntry } from "@/store";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";
import { AppToast, logger } from "@/utils";

export interface HistoryEntryRowProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
  /** Deletes the entry by id (local + cloud, with an Undo toast). */
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
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      onDelete(entry.id);
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
      Clipboard.setStringAsync(text)
        .then(() =>
          AppToast.info("Text copied to clipboard", { haptics: false }),
        )
        .catch((err) => logger.error("[History] Copy transcript failed", err));
    }, [entry.transcript]);

    const handleCopyTranslation = useCallback((): void => {
      const text = entry.translation?.trim();
      if (!text) return;
      setSheetVisible(false);
      triggerHaptic("selection");
      Clipboard.setStringAsync(text)
        .then(() =>
          AppToast.info("Translation copied to clipboard", { haptics: false }),
        )
        .catch((err) => logger.error("[History] Copy translation failed", err));
    }, [entry.translation]);

    const handleShare = useCallback((): void => {
      const parts = [
        entry.transcript?.trim(),
        entry.translation?.trim(),
      ].filter((part): part is string => !!part);
      setSheetVisible(false);
      track(AnalyticsEvents.RESULT_SHARED, { source: "history" });
      Share.share({ message: parts.join("\n\n") }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("dismissed")) {
          logger.error("[History] Share entry failed", err);
        }
      });
    }, [entry.transcript, entry.translation]);

    const handleSheetDelete = useCallback((): void => {
      setSheetVisible(false);
      handleDelete();
    }, [handleDelete]);

    const hasTranslation =
      !!entry.translation?.trim() &&
      entry.translation.trim() !== entry.transcript?.trim();

    const sheetTitle = `${getLanguageName(
      entry.sourceLang,
    )} → ${getLanguageName(entry.targetLang)}`;

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
