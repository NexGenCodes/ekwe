import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared";
import type { PlanLimits, Tier } from "@ekwe/shared";

export type { PlanLimits, Tier };
export { FREE_LIMITS, PREMIUM_LIMITS };

export function getLimits(tier: Tier): PlanLimits {
  return tier === "PREMIUM" ? PREMIUM_LIMITS : FREE_LIMITS;
}
