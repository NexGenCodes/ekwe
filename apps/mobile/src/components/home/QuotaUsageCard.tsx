import Activity from "lucide-react-native/icons/activity";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import { useRouter } from "expo-router";
import React, { useMemo, useCallback } from "react";
import { USAGE_METER_META } from "@ekwe/shared";
import type { UsageSnapshot } from "@ekwe/shared";

import { Box, Text, Spinner, Pressable } from "@/components/ui";
import { Card } from "@/components/Card";
import { SkeletonBox } from "@/components/SkeletonBox";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useUsageQuery, invalidateUsage } from "@/hooks/queries/useUsageQuery";
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

function usagePeriod(data: UsageSnapshot): "daily" | "monthly" {
  if (data.period === "daily" || data.period === "monthly") return data.period;
  return data.resetsAt === data.monthResetsAt ? "monthly" : "daily";
}

function resetsLabel(resetsAt: number, period: "daily" | "monthly"): string {
  const diff = resetsAt - Date.now();
  if (period === "daily") {
    if (diff <= 0) return "Resets soon";
    return "Resets at midnight UTC";
  }
  if (diff <= 0) return "Resets soon";
  return `Resets ${new Date(resetsAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} (UTC)`;
}

function PoolRow({
  label,
  unit,
  used,
  total,
  remaining,
  period,
}: PoolRowProps & { period: "daily" | "monthly" }): React.ReactElement {
  const { color } = useTheme();
  const meter = computeMeterState(used, total);
  const unavailable = total === 0;
  const statusText =
    total === null
      ? "Unlimited"
      : unavailable
        ? "Not available on this plan"
        : `${formatUsageNumber(used)} / ${formatUsageNumber(total)} ${unit}`;

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
          {statusText}
        </Text>
      </Box>

      {meter !== null && !unavailable ? (
        <Box
          style={[
            styles.track,
            { backgroundColor: withAlpha(color.muted, 0.18) },
          ]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total ?? 0, now: used }}
          accessibilityLabel={`${label}: ${formatUsageNumber(used)} of ${formatUsageNumber(total ?? 0)} ${unit} used this ${period === "daily" ? "day" : "month"}, ${formatUsageNumber(remaining ?? 0)} ${unit} left`}
        >
          <Box
            style={[
              styles.fill,
              {
                width: `${Math.max(meter.fraction * 100, meter.fraction > 0 ? 2 : 0)}%`,
                backgroundColor: color[meter.tone],
              },
            ]}
          />
        </Box>
      ) : !unavailable ? (
        <Box
          style={[
            styles.track,
            { backgroundColor: withAlpha(color.muted, 0.18) },
          ]}
        />
      ) : null}
    </Box>
  );
}

export function QuotaUsageCard(): React.ReactElement {
  const { color } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError } = useUsageQuery();

  const handleRefresh = useCallback(async (): Promise<void> => {
    await triggerHaptic();
    invalidateUsage();
  }, []);

  const period = data ? usagePeriod(data) : "daily";

  const { headline, showUpgrade } = useMemo(() => {
    if (isError || !data) return { headline: null, showUpgrade: false };

    const meters = data.meters.filter((p) => p.total !== 0);
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
        headline: {
          text:
            period === "daily"
              ? "Daily limit reached"
              : "Monthly limit reached",
          tone: "error" as const,
        },
        showUpgrade: true,
      };
    if (anyNear)
      return {
        headline: {
          text:
            period === "daily"
              ? "Almost out for today"
              : "Almost out this month",
          tone: "warning" as const,
        },
        showUpgrade: true,
      };
    return { headline: null, showUpgrade: false };
  }, [data, isError, period]);

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
            {period === "daily" ? "Today's usage" : "This month's usage"}
          </Text>
        </Box>

        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
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
              {resetsLabel(data.resetsAt, period)}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh usage"
            onPress={handleRefresh}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={isLoading}
          >
            <RefreshCw size={13} color={color.muted} />
          </Pressable>
        </Box>
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
        <Box
          style={{
            marginTop: spacing.md,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text variant="bodySmall" style={{ color: color.muted }}>
            Usage could not be loaded right now.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading usage"
            onPress={handleRefresh}
          >
            <Text
              variant="bodySmall"
              style={{ color: color.brand, fontWeight: "600" }}
            >
              Retry
            </Text>
          </Pressable>
        </Box>
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
                period={period}
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
          accessibilityLabel="Upgrade for higher limits."
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
            {period === "daily" ? "Need more today?" : "Need higher limits?"}
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
