import Activity from "lucide-react-native/icons/activity";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { USAGE_METER_META } from "@ekwe/shared";

import { Box, Text, Spinner, Pressable } from "@/components/ui";
import { Card } from "@/components/Card";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useUsageQuery } from "@/hooks/queries/useUsageQuery";
import { useTheme } from "@/hooks";
import { withAlpha } from "@/utils/color";
import { triggerHaptic } from "@/utils/haptics";
import { pushOnce } from "@/utils/navigation";

interface PoolRowProps {
  label: string;
  unit: string;
  used: number;
  total: number;
  remaining: number;
}

interface MeterState {
  fraction: number;
  tone: "brand" | "warning" | "error";
}

function computeMeterState(used: number, total: number): MeterState | null {
  if (total <= 0) return null;
  const fraction = Math.min(used / total, 1);
  const tone: MeterState["tone"] =
    fraction >= 1 ? "error" : fraction >= 0.75 ? "warning" : "brand";
  return { fraction, tone };
}

function formatUsageNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function PoolRow({
  label,
  unit,
  used,
  total,
  remaining,
}: PoolRowProps): React.ReactElement {
  const { color } = useTheme();
  const meter = computeMeterState(used, total);

  return (
    <Box style={styles.poolRow}>
      <Box style={styles.poolHeader}>
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={[styles.poolLabel, { color: color.foreground }]}
        >
          {label}
        </Text>
        <Text
          variant="caption"
          numberOfLines={1}
          style={[styles.poolValue, { color: color.muted }]}
        >
          {meter === null
            ? "Unlimited"
            : `${formatUsageNumber(used)} / ${formatUsageNumber(total)} ${unit} · ${formatUsageNumber(remaining)} left`}
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
  const router = useRouter();
  const { data, isLoading, isError } = useUsageQuery();

  const { headline, showUpgrade } = useMemo(() => {
    if (isError || !data) return { headline: null, showUpgrade: false };

    const meters = data.meters;
    const anyExhausted = meters.some((p) => p.total > 0 && p.remaining === 0);
    const anyNear = meters.some(
      (p) => p.total > 0 && p.remaining / p.total < 0.25 && p.remaining > 0,
    );

    if (anyExhausted)
      return {
        headline: { text: "Daily limit reached", tone: "error" as const },
        showUpgrade: true,
      };
    if (anyNear)
      return {
        headline: { text: "Almost out for today", tone: "warning" as const },
        showUpgrade: true,
      };
    return { headline: null, showUpgrade: false };
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
          {data.meters.map((meter) => {
            const displayMeta = USAGE_METER_META.find(
              (meta) => meta.id === meter.id,
            );

            return (
              <PoolRow
                key={meter.id}
                label={displayMeta?.label ?? meter.label}
                unit={displayMeta?.unit ?? meter.unit}
                used={meter.used}
                total={meter.total}
                remaining={meter.remaining}
              />
            );
          })}
        </Box>
      ) : null}

      {showUpgrade && (
        <Pressable
          onPress={() => {
            triggerHaptic();
            pushOnce(router, "/billing");
          }}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Upgrade to Pro. Unlimited translations and transcriptions."
          style={({ pressed }) => [
            styles.upgradeRow,
            { backgroundColor: withAlpha(color.brand, 0.08) },
            pressed && { backgroundColor: withAlpha(color.brand, 0.16) },
          ]}
        >
          <Text
            variant="bodySmall"
            style={{ color: color.brand, fontWeight: "600" }}
          >
            Need more today?
          </Text>
          <Box style={[styles.upgradePill, { backgroundColor: color.brand }]}>
            <Text
              variant="caption"
              style={{ color: color.onBrand, fontWeight: "600" }}
            >
              Go unlimited
            </Text>
          </Box>
        </Pressable>
      )}
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
  poolLabel: {
    flexShrink: 0,
  } as const,
  poolValue: {
    flexShrink: 1,
    textAlign: "right",
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
  upgradeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.lg,
  } as const,
  upgradePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  } as const,
};
