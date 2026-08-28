import Activity from "lucide-react-native/icons/activity";
import React, { useMemo } from "react";

import { Box, Text, Spinner } from "@/components/ui";
import { Card } from "@/components/Card";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useUsageQuery } from "@/hooks/queries/useUsageQuery";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";

interface PoolRowProps {
  label: string;
  used: number;
  total: number;
  remaining: number;
}

interface MeterState {
  fraction: number;
  tone: "brand" | "warning" | "error";
}

/**
 * Color the meter/status by how much of the pool has been consumed, so the
 * "reached quota" moment is visible at a glance before the hard 429.
 *  - < 75% consumed → brand (healthy)
 *  - 75–99%      → warning (getting close)
 *  - 100%        → error (reached daily limit)
 */
function computeMeterState(used: number, total: number): MeterState | null {
  if (total <= 0) return null; // unlimited
  const fraction = Math.min(used / total, 1);
  const tone: MeterState["tone"] =
    fraction >= 1 ? "error" : fraction >= 0.75 ? "warning" : "brand";
  return { fraction, tone };
}

function PoolRow({
  label,
  used,
  total,
  remaining,
}: PoolRowProps): React.ReactElement {
  const { color } = useTheme();
  const meter = computeMeterState(used, total);

  return (
    <Box style={styles.poolRow}>
      <Box style={styles.poolHeader}>
        <Text variant="bodySmall" style={{ color: color.foreground }}>
          {label}
        </Text>
        <Text variant="bodySmall" style={{ color: color.muted }}>
          {meter === null
            ? "Unlimited"
            : `${used} / ${total} used · ${remaining} left`}
        </Text>
      </Box>

      {meter !== null ? (
        <Box
          style={[
            styles.track,
            { backgroundColor: withAlpha(color.muted, 0.18) },
          ]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total, now: used }}
          accessibilityLabel={`${label}: ${used} of ${total} used today`}
        >
          <Box
            style={[
              styles.fill,
              {
                width: `${Math.max(meter.fraction * 100, 2)}%`,
                backgroundColor: color[meter.tone],
              },
            ]}
          />
        </Box>
      ) : (
        <Box
          style={[
            styles.track,
            { backgroundColor: withAlpha(color.muted, 0.18) },
          ]}
        />
      )}
    </Box>
  );
}

function resetsLabel(resetsAt: number): string {
  const diff = resetsAt - Date.now();
  if (diff <= 0) return "Resets at midnight";
  const hours = Math.ceil(diff / 3_600_000);
  return `Resets in ${hours}h`;
}

export function QuotaUsageCard(): React.ReactElement {
  const { color } = useTheme();
  const { data, isLoading, isError } = useUsageQuery();

  const headline = useMemo(() => {
    if (isError) return null;
    if (!data) return null;

    const pools = [data.translate, data.transcribe, data.tts];
    const anyExhausted = pools.some((p) => p.total > 0 && p.remaining === 0);
    const anyNear = pools.some(
      (p) => p.total > 0 && p.remaining / p.total < 0.25 && p.remaining > 0,
    );

    if (anyExhausted)
      return { text: "Daily limit reached", tone: "error" as const };
    if (anyNear)
      return { text: "Almost out for today", tone: "warning" as const };
    return null;
  }, [data, isError]);

  return (
    <Card padding="lg">
      <Box style={styles.header}>
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Activity size={18} color={color.foreground} />
          <Text
            variant="body"
            style={{ color: color.foreground, fontWeight: "600" }}
          >
            Today's usage
          </Text>
        </Box>

        {isLoading ? (
          <Spinner size="sm" />
        ) : headline ? (
          <Text
            variant="caption"
            style={[
              styles.headline,
              {
                color: color[headline.tone],
                backgroundColor: withAlpha(color[headline.tone], 0.12),
              },
            ]}
          >
            {headline.text}
          </Text>
        ) : data ? (
          <Text variant="caption" style={{ color: color.muted }}>
            {resetsLabel(data.resetsAt)}
          </Text>
        ) : null}
      </Box>

      {isError ? (
        <Text
          variant="bodySmall"
          style={{ color: color.muted, marginTop: spacing.md }}
        >
          Usage could not be loaded right now.
        </Text>
      ) : data ? (
        <Box style={styles.pools}>
          <PoolRow
            label="Translations"
            used={data.translate.used}
            total={data.translate.total}
            remaining={data.translate.remaining}
          />
          <PoolRow
            label="Transcriptions"
            used={data.transcribe.used}
            total={data.transcribe.total}
            remaining={data.transcribe.remaining}
          />
          {/* Premium-only worker speech: hidden for FREE (dailyTtsCharsLimit = 0)
              so the card never reads as "unlimited" for a feature that is a 403. */}
          {data.tts.total > 0 || data.tts.used > 0 ? (
            <PoolRow
              label="Speech"
              used={data.tts.used}
              total={data.tts.total}
              remaining={data.tts.remaining}
            />
          ) : null}
        </Box>
      ) : null}
    </Card>
  );
}

const styles = {
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as const,
  headline: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.hairline,
    borderRadius: borderRadius.full,
    overflow: "hidden",
    fontWeight: "600",
  } as const,
  pools: {
    marginTop: spacing.md,
    gap: spacing.md,
  } as const,
  poolRow: {
    gap: spacing.sm,
  } as const,
  poolHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as const,
  track: {
    height: 6,
    borderRadius: borderRadius.full,
    overflow: "hidden",
  } as const,
  fill: {
    height: "100%",
    borderRadius: borderRadius.full,
  } as const,
};
