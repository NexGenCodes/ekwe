import type { UsageMeterId, UsageSnapshot } from "@ekwe/shared";
import { usage$ } from "@/hooks/queries/useUsageQuery";

function currentSnapshot(): UsageSnapshot | undefined {
  const snapshot = usage$.get() as UsageSnapshot | undefined;
  if (!snapshot) return undefined;
  return snapshot.resetsAt > Date.now() ? snapshot : undefined;
}

/** `null` means unlimited or unknown; `0` means exhausted or unavailable. */
export function quotaRemaining(id: UsageMeterId): number | null {
  const meter = currentSnapshot()?.meters.find((entry) => entry.id === id);
  if (!meter || meter.total === null) return null;
  return meter.remaining ?? 0;
}

export function isQuotaExhausted(id: UsageMeterId): boolean {
  return quotaRemaining(id) === 0;
}

export function quotaResetLabel(): string {
  const snapshot = currentSnapshot();
  if (!snapshot) return "next month";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(snapshot.resetsAt));
}
