import Activity from "lucide-react-native/icons/activity";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { USAGE_METER_META } from "@ekwe/shared";

import { Box, Text, Spinner, Pressable } from "@/components/ui";
import { Card } from "@/components/Card";
import { SkeletonBox } from "@/components/SkeletonBox";
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
  total: number | null;
  remaining: number | null;
}

interface MeterState {
  fraction: number;
  tone: "brand" | "warning" | "error";
}

function computeMeterState(
  used: number,
  total: number | null,
): MeterState | null {
  if (total === null || total <= 0) return null;
  const fraction = Math.min(used / total, 1);
  const tone: MeterState["tone"] =
    fraction >= 1 ? "error" : fraction >= 0.75 ? "warning" : "brand";
  return { fraction, tone };
}

function formatUsageNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
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
          {total === null
            ? "Unlimited"
            : `${formatUsageNumber(used)} / ${formatUsageNumber(total)} ${unit}`}
        </Text>
      </Box>

      {meter !== null ? (
        <Box
          style={[
            styles.track,
            { backgroundColor: withAlpha(color.muted, 0.18) },
          ]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total ?? 0, now: used }}
          accessibilityLabel={`${label}: ${used} of ${total} used this month, ${formatUsageNumber(
            remaining ?? 0,
          )} ${unit} left`}
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
  if (diff <= 0) return "Resets next month";
  return `Resets ${new Date(resetsAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function QuotaUsageCard(): React.ReactElement {
  const { color } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError } = useUsageQuery();

  const { headline, showUpgrade } = useMemo(() => {
    if (isError || !data) return { headline: null, showUpgrade: false };

    const meters = data.meters;
    const anyExhausted = meters.some(
      (p) => p.total !== null && p.total > 0 && p.remaining === 0,
    );
    const anyNear = meters.some(
      (p) =>
        p.total !== null &&
        p.total > 0 &&
        p.remaining !== null &&
        p.remaining / p.total < 0.25 &&
        p.remaining > 0,
    );

    if (anyExhausted)
      return {
        headline: { text: "Monthly limit reached", tone: "error" as const },
        showUpgrade: true,
      };
    if (anyNear)
      return {
        headline: { text: "Almost out this month", tone: "warning" as const },
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
            This month's usage
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

      {isLoading ? (
        <Box style={styles.pools}>
          <Box style={styles.poolRow}>
            <Box style={styles.poolHeader}>
              <SkeletonBox
                width={120}
                height={14}
                borderRadius={borderRadius.sm}
              />
              <SkeletonBox
                width={72}
                height={12}
                borderRadius={borderRadius.sm}
              />
            </Box>
            <SkeletonBox
              width="100%"
              height={6}
              borderRadius={borderRadius.full}
            />
          </Box>
          <Box style={styles.poolRow}>
            <Box style={styles.poolHeader}>
              <SkeletonBox
                width={140}
                height={14}
                borderRadius={borderRadius.sm}
              />
              <SkeletonBox
                width={84}
                height={12}
                borderRadius={borderRadius.sm}
              />
            </Box>
            <SkeletonBox
              width="100%"
              height={6}
              borderRadius={borderRadius.full}
            />
          </Box>
        </Box>
      ) : isError ? (
        <Text
          variant="bodySmall"
          style={{ color: color.muted, marginTop: spacing.md }}
        >
          Usage could not be loaded right now.
        </Text>
      ) : data ? (
        <Box style={styles.pools}>
          {data.meters.map((meter) => {
            if (meter.total === 0) return null;

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
          accessibilityLabel="Upgrade for higher limits and no ads."
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
            Need more this month?
          </Text>
          <Box style={[styles.upgradePill, { backgroundColor: color.brand }]}>
            <Text
              variant="caption"
              style={{ color: color.onBrand, fontWeight: "600" }}
            >
              See plans
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
    flex: 1,
    marginRight: spacing.sm,
  } as const,
  poolValue: {
    flexShrink: 0,
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
