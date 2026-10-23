import {
  HISTORY_TTL_FREE_DAYS,
  HISTORY_TTL_PAID_DAYS,
} from "@ekwe/shared/retention";

/**
 * How long the device keeps its local mirror of history.
 *
 * It matches the server's own window so local pagination is complete without a
 * second remote query, and it widens with Paid exactly as the cloud copy does.
 * The pull cursor is keyed by tier, so a tier change re-pulls the full window
 * instead of leaving a gap behind rows the narrower window had pruned.
 */
export function historyLocalTtlDays(isPro: boolean): number {
  return isPro ? HISTORY_TTL_PAID_DAYS : HISTORY_TTL_FREE_DAYS;
}
