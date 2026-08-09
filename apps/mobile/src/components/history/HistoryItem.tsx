import { triggerHaptic } from "@/utils/haptics";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import AudioLines from "lucide-react-native/icons/audio-lines";
import Captions from "lucide-react-native/icons/captions";
import Languages from "lucide-react-native/icons/languages";
import Type from "lucide-react-native/icons/type";
import Upload from "lucide-react-native/icons/upload";
import React, { useCallback, useMemo } from "react";
import { AccessibilityActionEvent, ViewStyle, StyleSheet } from "react-native";

import { Card } from "../Card";

import { Box, Text, Pressable } from "@/components/ui";
import { getLanguageName } from "@/constants/languages";
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

      // Entries with both a transcript AND a distinct translation:
      // transcript is the hero, translation is the accented secondary.
      if (
        hasTranslation &&
        hasTranscript &&
        areDifferent &&
        (entryType === "both" || entryType === "translation")
      ) {
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
    }, [entry.transcript, entry.translation, entryType, color]);

    // Quiet metadata line — media type + duration (language pair lives in the tile).
    const metadataLabel = useMemo(() => {
      const isShared =
        entry.sourceApp &&
        entry.sourceApp !== "ekwe" &&
        entry.sourceApp !== "ekwe-home";

      const durationStr = formattedDuration ? ` · ${formattedDuration}` : "";
      let mediaType: string;
      if (entryType === "both") {
        mediaType = "Both";
      } else if (entryType === "transcription") {
        mediaType = "Transcription";
      } else if (isShared && (!entry.duration || entry.duration === 0)) {
        mediaType = "Shared Text";
      } else {
        mediaType = "Translation";
      }

      return `${mediaType}${durationStr}`;
    }, [entry.sourceApp, entry.duration, entryType, formattedDuration]);

    // Metadata icon — signals how the entry was produced.
    // transcription → captions (spoken audio shown as text); translation →
    // languages; both → mic-audio-lines (voice transcribed and translated);
    // shared/typed → upload/keyboard.
    const metadataIcon = useMemo(() => {
      const isShared =
        entry.sourceApp &&
        entry.sourceApp !== "ekwe" &&
        entry.sourceApp !== "ekwe-home";
      if (isShared) {
        return <Upload size={iconSize.xs} color={color.muted} />;
      }
      if (entryType === "translation") {
        return <Languages size={iconSize.xs} color={color.muted} />;
      }
      if (entryType === "both") {
        return (
          <Box style={styles.bothGlyph}>
            <AudioLines size={iconSize.xs} color={color.muted} />
            <Box style={[styles.bothBadge, { backgroundColor: color.muted }]}>
              <Languages size={6} color={color.card} strokeWidth={2.5} />
            </Box>
          </Box>
        );
      }
      if (!entry.duration || entry.duration === 0) {
        return <Type size={iconSize.xs} color={color.muted} />;
      }
      return <Captions size={iconSize.xs} color={color.muted} />;
    }, [entry.sourceApp, entry.duration, entryType, color.muted, color.card]);

    // Signature element — the language pair as a compact badge.
    // Translations read as a brand-tinted source→target stack; plain
    // transcriptions as a single quiet code. Auto-sizes to hug its content.
    const langTile = useMemo((): React.ReactElement => {
      const srcCode = entry.sourceLang.toUpperCase();
      const tgtCode = entry.targetLang.toUpperCase();
      const tileBg = isTranslation
        ? withAlpha(color.brand, 0.1)
        : withAlpha(color.foreground, 0.06);
      const tileBorder = isTranslation
        ? withAlpha(color.brand, 0.2)
        : withAlpha(color.foreground, 0.1);
      const codeColor = isTranslation ? color.brand : color.foreground;

      return (
        <Box
          style={[
            styles.langTile,
            { backgroundColor: tileBg, borderColor: tileBorder },
          ]}
        >
          {isTranslation ? (
            <Box style={styles.langTilePair}>
              <Text
                variant="caption"
                style={[styles.langCode, { color: codeColor }]}
              >
                {srcCode}
              </Text>
              <ArrowDown size={10} color={withAlpha(codeColor, 0.5)} />
              <Text
                variant="caption"
                style={[styles.langCode, { color: codeColor }]}
              >
                {tgtCode}
              </Text>
            </Box>
          ) : (
            <Text
              variant="caption"
              style={[styles.langCode, { color: codeColor }]}
            >
              {srcCode}
            </Text>
          )}
        </Box>
      );
    }, [entry.sourceLang, entry.targetLang, isTranslation, color]);

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
      <Card padding="none" style={cardStyle}>
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          onAccessibilityAction={handleAccessibilityAction}
          accessibilityActions={[{ name: "delete", label: "Delete entry" }]}
          accessibilityLabel={pressableLabel}
          accessibilityHint="Swipe left or long press for more actions"
          style={styles.contentContainer}
        >
          {langTile}

          <Box style={styles.contentBody}>
            {/* Hero content */}
            <Box style={styles.snippetBody}>{snippetBody}</Box>

            {/* Metadata — media type + relative time */}
            <Box style={styles.metaRow}>
              <Box style={styles.metaLeft}>
                {metadataIcon}
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
  langTile: {
    minWidth: 40,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  langTilePair: {
    alignItems: "center",
    gap: 1,
  },
  langCode: {
    fontWeight: "600",
    letterSpacing: 0.3,
    lineHeight: 13,
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
  bothGlyph: {
    position: "relative",
    width: 16,
    height: 12,
  },
  bothBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 9,
    height: 9,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
