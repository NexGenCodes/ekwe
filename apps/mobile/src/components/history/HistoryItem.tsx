import { triggerHaptic } from "@/utils/haptics";
import Captions from "lucide-react-native/icons/captions";
import Languages from "lucide-react-native/icons/languages";
import React, { useCallback, useMemo } from "react";
import { AccessibilityActionEvent, ViewStyle, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { Card } from "../Card";

import { Box, Text, Pressable } from "@/components/ui";
import { getLanguageName } from "@/constants/languages";
import { scale } from "@/constants/motion";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { getEntryType } from "@/hooks/useHistorySearch";
import { HistoryEntry } from "@/store";
import { withAlpha } from "@/utils/color";
import { getRelativeTime } from "@/utils/relativeTime";

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
  /** Deletes the entry (used by the accessibility "delete" action). */
  onDelete: (entry: HistoryEntry) => void;
  /** Optional long-press handler (e.g. to open a context sheet). */
  onLongPress?: (entry: HistoryEntry) => void;
  style?: ViewStyle;
}

export const HistoryItem = React.memo(
  ({
    entry,
    onPress,
    onDelete,
    onLongPress,
    style,
  }: HistoryItemProps): React.ReactElement => {
    const { color } = useTheme();

    const handlePress = useCallback((): void => {
      triggerHaptic("selection");
      onPress(entry);
    }, [entry, onPress]);

    const handleLongPress = useCallback((): void => {
      triggerHaptic("selection");
      onLongPress?.(entry);
    }, [entry, onLongPress]);

    const handleAccessibilityAction = useCallback(
      (event: AccessibilityActionEvent): void => {
        if (event.nativeEvent.actionName === "delete") {
          triggerHaptic("selection");
          onDelete(entry);
        }
      },
      [entry, onDelete],
    );

    // Semantic type from the persisted producing operation (audio or text).
    // A transcribed entry may carry a derived translation, but its type stays
    // "transcription" — a user either transcribes or translates, never both.
    const entryType = useMemo(() => getEntryType(entry), [entry]);
    const isTranslation = entryType === "translation";

    // Hero content: transcript (foreground) with distinct translation (brand) below.
    const snippetBody = useMemo((): React.ReactNode => {
      const hasTranscript = !!entry.transcript?.trim();
      const hasTranslation = !!entry.translation?.trim();
      const areDifferent =
        entry.transcript?.trim() !== entry.translation?.trim();

      if (!hasTranscript && !hasTranslation) {
        return (
          <Text variant="bodySmall" style={{ color: color.muted }}>
            No transcript available
          </Text>
        );
      }

      // Entries with both a transcript AND a distinct translation (whether the
      // entry was transcribed or is a pure translation): transcript is the hero,
      // translation is the accented secondary.
      if (hasTranslation && hasTranscript && areDifferent) {
        return (
          <Box style={{ gap: spacing.xs }}>
            <Text
              variant="body"
              numberOfLines={2}
              ellipsizeMode="tail"
              style={{ color: color.foreground }}
            >
              {entry.transcript?.trim()}
            </Text>
            <Box
              style={[
                styles.translationBlock,
                { borderLeftColor: color.brand },
              ]}
            >
              <Text
                variant="bodySmall"
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{ color: color.brand }}
              >
                {entry.translation?.trim()}
              </Text>
            </Box>
          </Box>
        );
      }

      // Single-content entry (transcription or shared text): plain hero text.
      const textToShow = entry.transcript?.trim() || entry.translation?.trim();
      return (
        <Text
          variant="body"
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{ color: color.foreground }}
        >
          {textToShow}
        </Text>
      );
    }, [entry.transcript, entry.translation, color]);

    // Format duration nicely — audio metadata belongs to transcriptions only
    // (translations are text → text and carry no recording).
    const formattedDuration = useMemo(() => {
      if (!entry.duration) return null;
      const seconds = Math.round(entry.duration);
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      if (minutes < 60) {
        return remainingSeconds > 0
          ? `${minutes}m ${remainingSeconds}s`
          : `${minutes}m`;
      }
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m`
        : `${hours}h`;
    }, [entry.duration]);

    // Quiet metadata line — the producing operation ("type"), the audio
    // metadata for transcriptions (duration · source language), and the compact
    // language pair for translations. The circular type-icon badge on the left
    // already signals the kind of entry, so the origin stays off-screen.
    const metadataLabel = useMemo(() => {
      const langStr = isTranslation
        ? `${entry.sourceLang.toUpperCase()} → ${entry.targetLang.toUpperCase()}`
        : entry.sourceLang.toUpperCase();
      const mediaType =
        entryType === "translation" ? "Translation" : "Transcription";
      const durationStr = isTranslation
        ? ""
        : formattedDuration
          ? ` · ${formattedDuration}`
          : "";
      return `${mediaType}${durationStr} · ${langStr}`;
    }, [
      entryType,
      entry.sourceLang,
      entry.targetLang,
      isTranslation,
      formattedDuration,
    ]);

    // Signature element — the entry-type icon in a circular badge.
    // Either you transcribe or you translate: the left circle is the type icon
    // (captions for transcription, languages for translation), and the compact
    // language pair moves into the metadata line.
    const typeIconTile = useMemo(
      (): React.ReactElement => (
        <Box
          style={[
            styles.typeIconTile,
            {
              backgroundColor: isTranslation
                ? withAlpha(color.brand, 0.12)
                : withAlpha(color.foreground, 0.06),
              borderColor: isTranslation
                ? withAlpha(color.brand, 0.2)
                : withAlpha(color.foreground, 0.1),
            },
          ]}
        >
          {isTranslation ? (
            <Languages size={iconSize.sm} color={color.brand} />
          ) : (
            <Captions size={iconSize.sm} color={color.foreground} />
          )}
        </Box>
      ),
      [isTranslation, color],
    );

    const cardStyle = useMemo(
      () => [
        styles.itemCard,
        { borderColor: color.border, backgroundColor: color.card },
        style,
      ],
      [color.border, color.card, style],
    );

    const pressableLabel = useMemo(
      () =>
        `${entry.transcript?.split("\n")[0] || "Voice Note"}. ${getLanguageName(entry.sourceLang)} to ${getLanguageName(entry.targetLang)}`,
      [entry.transcript, entry.sourceLang, entry.targetLang],
    );

    const captionStyle = useMemo(() => ({ color: color.muted }), [color.muted]);

    // Shared element tag: `history-snippet-${id}` links this row to the detail
    // sheet's ORIGINAL block, producing a coordinate morph on history → result
    // navigation (result.tsx mounts HistoryEntryDetail with the same tag).
    const sharedTag = useMemo(() => `history-snippet-${entry.id}`, [entry.id]);

    return (
      <Card padding="none" style={cardStyle}>
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          onAccessibilityAction={handleAccessibilityAction}
          accessibilityActions={[{ name: "delete", label: "Delete entry" }]}
          accessibilityLabel={pressableLabel}
          accessibilityHint="Swipe left or long press for more actions"
          feedback="none"
          style={({ pressed }) => [
            styles.contentContainer,
            pressed && {
              transform: [{ scale: scale.pressIn }],
              backgroundColor: withAlpha(color.foreground, 0.04),
            },
          ]}
        >
          {typeIconTile}

          <Box style={styles.contentBody}>
            {/* Hero content */}
            <Box style={styles.snippetBody}>
              <Animated.View sharedTransitionTag={sharedTag}>
                {snippetBody}
              </Animated.View>
            </Box>

            {/* Metadata — producing origin + language pair + relative time */}
            <Box style={styles.metaRow}>
              <Box style={styles.metaLeft}>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={captionStyle}
                >
                  {metadataLabel}
                </Text>
              </Box>
              <Text variant="caption" style={captionStyle}>
                {getRelativeTime(entry.timestamp)}
              </Text>
            </Box>
          </Box>
        </Pressable>
      </Card>
    );
  },
  (prev, next) =>
    prev.entry.id === next.entry.id &&
    prev.entry.timestamp === next.entry.timestamp &&
    prev.entry.transcript === next.entry.transcript &&
    prev.entry.translation === next.entry.translation &&
    prev.entry.duration === next.entry.duration &&
    prev.entry.type === next.entry.type &&
    prev.entry.sourceLang === next.entry.sourceLang &&
    prev.entry.targetLang === next.entry.targetLang &&
    prev.entry.sourceApp === next.entry.sourceApp &&
    prev.onPress === next.onPress &&
    prev.onDelete === next.onDelete &&
    prev.onLongPress === next.onLongPress &&
    prev.style === next.style,
);

const styles = StyleSheet.create({
  itemCard: {
    borderRadius: borderRadius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    overflow: "hidden",
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  contentBody: {
    flex: 1,
    gap: spacing.sm,
  },
  // Circular entry-type icon badge (replaces the old language chip).
  typeIconTile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  snippetBody: {
    gap: spacing.xs,
  },
  // Left-accent border block for translated text (design system spec)
  translationBlock: {
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 1,
  },
});
