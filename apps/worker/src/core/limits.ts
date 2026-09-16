/**
 * ─── Tier Limits (Worker Single Source of Truth) ─────────────────
 *
 * Every rate-limit and quota check in the worker calls `getLimits(tier)`
 * from this file. Today it delegates to `@ekwe/shared` constants; when
 * KV/Supabase dynamic lookup is added, only this file changes — callers
 * are untouched.
 */

import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared";
import type { PlanLimits, Tier } from "@ekwe/shared";

export type { PlanLimits, Tier };
export { FREE_LIMITS, PREMIUM_LIMITS };

export function getLimits(tier: Tier): PlanLimits {
  return tier === "PREMIUM" ? PREMIUM_LIMITS : FREE_LIMITS;
}
