import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { Mic, Trash2, Upload, Type } from "lucide-react-native";
import React, { useRef, useCallback, useMemo } from "react";
import { ViewStyle, StyleSheet } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { Badge } from "../Badge";
import { Card } from "../Card";

import { Box, Text, Pressable } from "@/components/ui";
import { getLanguageName } from "@/constants/languages";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { getEntryType } from "@/hooks/useHistorySearch";
import { HistoryEntry } from "@/store";
import { isIOS } from "@/utils";
import { getRelativeTime } from "@/utils/relativeTime";

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  style?: ViewStyle;
}

export const HistoryItem = React.memo(
  ({
    entry,
    onPress,
    onDelete,
    style,
  }: HistoryItemProps): React.ReactElement => {
    const swipeableRef = useRef<Swipeable>(null);

    const { color } = useTheme();

    const handlePress = useCallback((): void => {
      Haptics.selectionAsync();
      onPress(entry);
    }, [entry, onPress]);

    const handleDelete = useCallback((): void => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onDelete(entry.id);
      swipeableRef.current?.close();
    }, [entry.id, onDelete]);

    const rightActionBg = useMemo(() => `${color.error}20`, [color.error]);

    const deleteAccessibilityLabel = useMemo(
      () => `Delete ${entry.transcript?.split("\n")[0] || "entry"}`,
      [entry.transcript],
    );

    const trashIconStyle = useMemo(
      () => ({ width: iconSize.md, height: iconSize.md }),
      [],
    );

    const renderRightActions = useCallback(
      (): React.ReactElement => (
        <Box
          style={[
            styles.rightActionContainer,
            { backgroundColor: rightActionBg },
          ]}
        >
          <Pressable
            testID="delete-button"
            hitSlop={spacing.sm}
            onPress={handleDelete}
            style={styles.deleteButton}
            accessibilityLabel={deleteAccessibilityLabel}
          >
            {isIOS ? (
              <ExpoImage
                source="sf:trash.fill"
                style={trashIconStyle}
                tintColor={color.error}
              />
            ) : (
              <Trash2 size={24} color={color.error} />
            )}
          </Pressable>
        </Box>
      ),
      [rightActionBg, handleDelete, deleteAccessibilityLabel, color.error],
    );

    // Format duration nicely
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

    // Semantic type: transcription | translation | both
    const entryType = useMemo(() => getEntryType(entry), [entry]);
    const isTranslation = entryType !== "transcription";

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

      // Show dual-text + accent border for entries that have both
      // a transcript AND a distinct translation (entryType === 'both' or 'translation')
      if (
        (entryType === "both" || entryType === "translation") &&
        hasTranslation &&
        hasTranscript &&
        areDifferent
      ) {
        return (
          <Box style={{ gap: spacing.xs }}>
            {/* Original transcript — muted, one line */}
            <Text
              variant="bodySmall"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: color.muted }}
            >
              {entry.transcript?.trim()}
            </Text>
            {/* Translation — accented with left border per design system */}
            <Box
              style={[
                styles.translationBlock,
                { borderLeftColor: color.secondary },
              ]}
            >
              <Text
                variant="body"
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{ color: color.secondary }}
              >
                {entry.translation?.trim()}
              </Text>
            </Box>
          </Box>
        );
      }

      // Transcription or translation-only: show the single available text
      const textToShow = entry.translation?.trim() || entry.transcript?.trim();
      const textColor =
        entryType === "transcription" ? color.foreground : color.secondary;
      return (
        <Text
          variant="bodySmall"
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{ color: textColor }}
        >
          {textToShow}
        </Text>
      );
    }, [entry.transcript, entry.translation, entryType, color, spacing]);

    // Resolve media badge label — transcription/translation entries get clear type labels
    const mediaBadgeLabel = useMemo(() => {
      const isShared =
        entry.sourceApp &&
        entry.sourceApp !== "ekwe" &&
        entry.sourceApp !== "ekwe-home";
      const durationStr = formattedDuration ? ` • ${formattedDuration}` : "";

      if (entryType === "both") {
        return `Both${durationStr}`;
      }
      if (entryType === "transcription") {
        return `Transcription${durationStr}`;
      }
      // entryType === 'translation'
      if (isShared && (!entry.duration || entry.duration === 0)) {
        return "Shared Text";
      }
      return `Translation${durationStr}`;
    }, [entryType, entry.sourceApp, entry.duration, formattedDuration]);

    // Resolve media badge icon
    const mediaBadgeIcon = useMemo(() => {
      const isShared =
        entry.sourceApp &&
        entry.sourceApp !== "ekwe" &&
        entry.sourceApp !== "ekwe-home";
      if (isShared) {
        return <Upload size={iconSize.xs} color={color.muted} />;
      }
      if (!entry.duration || entry.duration === 0) {
        return <Type size={iconSize.xs} color={color.muted} />;
      }
      return <Mic size={iconSize.xs} color={color.muted} />;
    }, [entry.sourceApp, entry.duration, color.muted]);

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

    return (
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        friction={2}
        rightThreshold={40}
        containerStyle={styles.swipeableContainer}
      >
        <Card padding="none" style={cardStyle}>
          <Pressable
            onPress={handlePress}
            style={styles.contentContainer}
            accessibilityLabel={pressableLabel}
          >
            {/* Badge row — language + media type */}
            <Box style={styles.badgeRow}>
              {isTranslation ? (
                <Badge
                  label={`${entry.sourceLang.toUpperCase()} → ${entry.targetLang.toUpperCase()}`}
                  variant="muted"
                  size="sm"
                />
              ) : (
                <Badge
                  label={entry.sourceLang.toUpperCase()}
                  variant="muted"
                  size="sm"
                />
              )}
              <Badge
                label={mediaBadgeLabel}
                variant="muted"
                size="sm"
                icon={mediaBadgeIcon}
              />
            </Box>

            {/* Snippet body */}
            <Box style={styles.snippetBody}>{snippetBody}</Box>

            {/* Footer — timestamp */}
            <Box style={styles.footer}>
              <Text variant="caption" style={captionStyle}>
                {getRelativeTime(entry.timestamp)}
              </Text>
            </Box>
          </Pressable>
        </Card>
      </Swipeable>
    );
  },
  (prev, next) =>
    prev.entry.id === next.entry.id &&
    prev.entry.timestamp === next.entry.timestamp &&
    prev.entry.transcript === next.entry.transcript &&
    prev.entry.translation === next.entry.translation &&
    prev.entry.duration === next.entry.duration &&
    prev.entry.sourceLang === next.entry.sourceLang &&
    prev.entry.targetLang === next.entry.targetLang &&
    prev.entry.sourceApp === next.entry.sourceApp &&
    prev.onPress === next.onPress &&
    prev.onDelete === next.onDelete &&
    prev.style === next.style,
);

const styles = StyleSheet.create({
  swipeableContainer: {
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  itemCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  contentContainer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  snippetBody: {
    gap: spacing.xs,
  },
  // Left-accent border block for translated text (design system spec)
  translationBlock: {
    borderLeftWidth: 3,
    paddingLeft: spacing.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.xs,
  },
  rightActionContainer: {
    width: spacing["6xl"],
    justifyContent: "center",
    borderRadius: borderRadius.xl,
  },
  deleteButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
});
