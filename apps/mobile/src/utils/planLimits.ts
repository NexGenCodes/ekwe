import { PLAN_LIMITS, type PlanLimits } from "@/constants/billing";
import { auth$ } from "@/store/auth";

/**
 * Limits for the account's current entitlement. Services must read this at call
 * time instead of importing `PREMIUM_LIMITS`, otherwise free users are checked
 * against the premium plan.
 */
export function getActivePlanLimits(): PlanLimits {
  return PLAN_LIMITS[auth$.isPro.peek() ? "pro" : "free"];
}
