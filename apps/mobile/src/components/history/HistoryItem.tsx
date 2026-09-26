import { triggerHaptic } from "@/utils/haptics";
import CircleDot from "lucide-react-native/icons/circle-dot";
import Mic from "lucide-react-native/icons/mic";
import Share2 from "lucide-react-native/icons/share-2";
import React, { useCallback, useMemo } from "react";
import { AccessibilityActionEvent, ViewStyle, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { ORIGIN_META } from "@ekwe/shared";
import type { HistoryOrigin } from "@ekwe/shared";

import { Card } from "@/components/Card";

import { Box, Text, Pressable } from "@/components/ui";
import { scale } from "@/constants/motion";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { hasTranslation } from "@/hooks/useHistorySearch";
import {
  entryAccessibilityLabel,
  entryLanguageLabel,
  formatEntryDuration,
  originProvenanceLabel,
  resolveOrigin,
} from "@/utils/historyOrigin";
import { getRelativeTime } from "@/utils/relativeTime";
import { HistoryEntry } from "@/store";
import { withAlpha } from "@/utils/color";

const ORIGIN_ICONS = {
  "speech-studio": Mic,
  echo: Share2,
  orb: CircleDot,
} as const satisfies Record<HistoryOrigin, typeof Mic>;

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
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

    const origin = useMemo(() => resolveOrigin(entry), [entry]);
    const isTranslated = useMemo(() => hasTranslation(entry), [entry]);
    const OriginIcon = ORIGIN_ICONS[origin];

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

    const metadataLabel = useMemo(() => {
      // Provenance first, then what happened to the text, then how long the
      // source audio was. The translated/untranslated distinction is already
      // carried by the tile and the indented translation block, so it is not
      // repeated here.
      const parts = [originProvenanceLabel(entry), entryLanguageLabel(entry)];
      const duration = formatEntryDuration(entry.duration);
      if (duration) parts.push(duration);
      return parts.filter(Boolean).join(" · ");
    }, [entry]);

    const typeIconTile = useMemo(
      (): React.ReactElement => (
        <Box
          style={[
            styles.typeIconTile,
            {
              backgroundColor: isTranslated
                ? withAlpha(color.brand, 0.12)
                : withAlpha(color.foreground, 0.06),
              borderColor: isTranslated
                ? withAlpha(color.brand, 0.2)
                : withAlpha(color.foreground, 0.1),
            },
          ]}
        >
          <OriginIcon
            size={iconSize.sm}
            color={isTranslated ? color.brand : color.foreground}
          />
        </Box>
      ),
      [isTranslated, color, OriginIcon],
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
      () => entryAccessibilityLabel(entry),
      [entry],
    );

    const originHint = useMemo(() => ORIGIN_META[origin].description, [origin]);

    const captionStyle = useMemo(() => ({ color: color.muted }), [color.muted]);

    const sharedTag = useMemo(() => `history-snippet-${entry.id}`, [entry.id]);

    return (
      <Card padding="none" style={cardStyle}>
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          onAccessibilityAction={handleAccessibilityAction}
          accessibilityActions={[{ name: "delete", label: "Delete entry" }]}
          accessibilityLabel={pressableLabel}
          accessibilityHint={`${originHint}. Long press for more actions`}
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
            <Box style={styles.snippetBody}>
              <Animated.View sharedTransitionTag={sharedTag}>
                {snippetBody}
              </Animated.View>
            </Box>

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
    prev.entry.origin === next.entry.origin &&
    prev.entry.input === next.entry.input &&
    prev.entry.sourceLang === next.entry.sourceLang &&
    prev.entry.targetLang === next.entry.targetLang &&
    prev.entry.sourceApp === next.entry.sourceApp &&
    prev.entry.voiceId === next.entry.voiceId &&
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
