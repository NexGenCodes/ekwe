import * as Haptics from "expo-haptics";
import AppWindow from "lucide-react-native/icons/app-window";
import Clock from "lucide-react-native/icons/clock";
import ShareIcon from "lucide-react-native/icons/share";
import Timer from "lucide-react-native/icons/timer";
import Trash2 from "lucide-react-native/icons/trash";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedCopyButton } from "@/components/AnimatedCopyButton";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Transliteration } from "@/components/Transliteration";
import { Box, Pressable, ScrollArea, Text } from "@/components/ui";
import { getLanguageName, getLanguageFlag } from "@/constants/languages";
import { borderRadius, iconSize } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { CopyService } from "@/services/copyOutService";
import { ShareOutService } from "@/services/shareOutService";
import type { HistoryEntry } from "@/store";
import { withAlpha } from "@/utils/color";
import { formatDuration } from "@/utils/formatDuration";
import { originProvenanceLabel } from "@/utils/historyOrigin";
import { triggerHaptic } from "@/utils/haptics";
import { getRelativeTime } from "@/utils/relativeTime";

export interface HistoryEntryDetailProps {
  entry: HistoryEntry;
  onDelete: () => void;
}

interface MetaChipProps {
  icon: React.ReactNode;
  label: string;
}

const MetaChip = React.memo(function MetaChip({
  icon,
  label,
}: MetaChipProps): React.ReactElement {
  const { color } = useTheme();

  const bg = withAlpha(color.foreground, 0.05);
  const fg = color.muted;

  return (
    <Box style={[styles.metaChip, { backgroundColor: bg }]}>
      {icon}
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </Box>
  );
});

interface DetailBlockProps {
  title: string;
  text: string;
  variant?: "default" | "accent";
  transliteration?: string | null;
  flag?: string;
  sharedTag?: string;
}
function DetailBlock({
  title,
  text,
  variant = "default",
  transliteration,
  flag,
  sharedTag,
}: DetailBlockProps): React.ReactElement {
  const { color } = useTheme();

  return (
    <Box style={styles.block}>
      <Card
        variant={variant}
        padding="lg"
        style={{ borderRadius: borderRadius["2xl"] }}
      >
        <Box style={styles.blockHeader}>
          <Box style={styles.blockLabelRow}>
            {flag ? <Text style={styles.blockFlag}>{flag}</Text> : null}
            <Text
              variant="caption"
              style={[
                styles.blockTitle,
                {
                  color: variant === "accent" ? color.foreground : color.muted,
                },
              ]}
            >
              {title}
            </Text>
          </Box>
          <AnimatedCopyButton
            textToCopy={text}
            size={18}
            accessibilityLabel={`Copy ${title.toLowerCase()}`}
            style={[
              styles.copyChip,
              { backgroundColor: withAlpha(color.foreground, 0.06) },
            ]}
          />
        </Box>
        <Box style={[styles.blockDivider, { backgroundColor: color.border }]} />
        <Animated.View sharedTransitionTag={sharedTag}>
          <Text variant="bodyLarge" style={{ color: color.foreground }}>
            {text}
          </Text>
          {transliteration ? <Transliteration text={transliteration} /> : null}
        </Animated.View>
      </Card>
    </Box>
  );
}

export const HistoryEntryDetail = React.memo(
  function HistoryEntryDetail({
    entry,
    onDelete,
  }: HistoryEntryDetailProps): React.ReactElement {
    const { color } = useTheme();
    const insets = useSafeAreaInsets();
    // The copy call itself now lives in CopyService; only the transient
    // "Copied" label is local state, so a plain ref+timer replaces the hook.
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      return (): void => {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      };
    }, []);

    const copy = useCallback((text: string): void => {
      void CopyService.copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      });
    }, []);

    const sharedTag = `history-snippet-${entry.id}`;

    const hasTranslation = useMemo(
      () =>
        !!entry.translation?.trim() &&
        entry.translation.trim() !== entry.transcript?.trim(),
      [entry.translation, entry.transcript],
    );

    const sourceName = getLanguageName(entry.sourceLang);
    const targetName = getLanguageName(entry.targetLang);
    const sourceFlag = getLanguageFlag(entry.sourceLang);
    const targetFlag = getLanguageFlag(entry.targetLang);
    const durationLabel = formatDuration(entry.duration);

    const handlePrimaryCopy = useCallback((): void => {
      if (hasTranslation) {
        copy(entry.translation ?? "");
      } else {
        copy(entry.transcript);
      }
    }, [copy, entry.translation, entry.transcript, hasTranslation]);

    const handleShare = useCallback((): void => {
      triggerHaptic("selection");
      const parts = [
        entry.transcript?.trim(),
        entry.translation?.trim(),
      ].filter((part): part is string => !!part);
      // Text only, for the same reason as the row: History keeps no audio.
      void ShareOutService.shareArtifact(
        null,
        parts.join("\n\n") || null,
        "history",
      );
    }, [entry.transcript, entry.translation]);

    const handleDelete = useCallback((): void => {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      onDelete();
    }, [onDelete]);

    const primaryLabel = copied
      ? "Copied"
      : hasTranslation
        ? "Copy translation"
        : "Copy text";

    return (
      <Box style={styles.root}>
        <ScrollArea
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <DetailBlock
            flag={sourceFlag}
            title={`ORIGINAL · ${sourceName}`}
            text={entry.transcript}
            sharedTag={sharedTag}
          />
          {hasTranslation && (
            <DetailBlock
              flag={targetFlag}
              variant="accent"
              title={`TRANSLATED · ${targetName}`}
              text={entry.translation ?? ""}
              transliteration={entry.transliteration}
            />
          )}

          <Box style={styles.footer}>
            <Box
              style={[styles.footerDivider, { backgroundColor: color.border }]}
            />
            <Box style={styles.footerChips}>
              {entry.timestamp > 0 && (
                <MetaChip
                  icon={<Clock size={iconSize.sm} color={color.muted} />}
                  label={getRelativeTime(entry.timestamp)}
                />
              )}
              {durationLabel && (
                <MetaChip
                  icon={<Timer size={iconSize.sm} color={color.muted} />}
                  label={durationLabel}
                />
              )}
              <MetaChip
                icon={<AppWindow size={iconSize.sm} color={color.muted} />}
                label={originProvenanceLabel(entry)}
              />
            </Box>
          </Box>
        </ScrollArea>

        <Box
          style={[
            styles.actionBar,
            {
              borderTopColor: color.border,
              backgroundColor: color.background,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <Button
            variant="primary"
            size="medium"
            label={primaryLabel}
            onPress={handlePrimaryCopy}
            style={styles.primaryAction}
          />
          <Pressable
            onPress={handleShare}
            style={[styles.iconAction, { borderColor: color.border }]}
            accessibilityRole="button"
            accessibilityLabel="Share entry"
          >
            <ShareIcon size={20} color={color.foreground} />
          </Pressable>
          <Pressable
            onPress={handleDelete}
            style={[
              styles.iconAction,
              {
                borderColor: withAlpha(color.error, 0.35),
                backgroundColor: withAlpha(color.error, 0.08),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Delete entry"
          >
            <Trash2 size={20} color={color.error} />
          </Pressable>
        </Box>
      </Box>
    );
  },
  (prev, next) => prev.entry === next.entry && prev.onDelete === next.onDelete,
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  block: {
    marginBottom: spacing.xl,
  },
  blockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  blockLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexShrink: 1,
  },
  blockFlag: {
    fontSize: 14,
    lineHeight: 16,
  },
  blockTitle: {
    textTransform: "uppercase",
    flexShrink: 1,
  },
  blockDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  copyChip: {
    padding: spacing.sm,
    borderRadius: borderRadius.full,
  },
  footer: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  footerDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.md,
  },
  footerChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  primaryAction: {
    flex: 1,
  },
  iconAction: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
