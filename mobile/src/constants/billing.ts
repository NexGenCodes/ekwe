import { FREE_FEATURES, FREE_LIMITS, PREMIUM_FEATURES, PREMIUM_LIMITS } from "@shared/plans";
import type { PlanFeatures as SharedPlanFeatures, PlanLimits as SharedPlanLimits } from "@shared/plans";

export type PlanLimits = SharedPlanLimits;

export const PLAN_LIMITS: { free: PlanLimits; pro: PlanLimits } = {
  free: FREE_LIMITS,
  pro: PREMIUM_LIMITS,
};

export const PLAN_FEATURES: { free: SharedPlanFeatures; pro: SharedPlanFeatures } = {
  free: FREE_FEATURES,
  pro: PREMIUM_FEATURES,
};

export interface FallbackPrice {
  amount: number;
  currency: string;
  symbol: string;
}

function computeSavingPercent(monthlyAmount: number, annualAmount: number): number {
  return Math.round((1 - annualAmount / (monthlyAmount * 12)) * 100);
}

export const DISPLAY_PRICING: Record<
  string,
  {
    monthly: FallbackPrice;
    annual: FallbackPrice;
    annualMonthlyCost: number;
    annualSavingPercent: number;
  }
> = {
  USD: ((): {
    monthly: FallbackPrice;
    annual: FallbackPrice;
    annualMonthlyCost: number;
    annualSavingPercent: number;
  } => {
    const monthly = { amount: 3.00, currency: "USD", symbol: "$" };
    const annual = { amount: 28.80, currency: "USD", symbol: "$" };
    const annualMonthlyCost = +(annual.amount / 12).toFixed(2);
    return {
      monthly,
      annual,
      annualMonthlyCost,
      annualSavingPercent: computeSavingPercent(monthly.amount, annual.amount),
    };
  })(),
};

export interface PlanFeature {
  title: string;
  included: boolean;
}

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Basic",
    tagline: "The full translation experience, with ads",
    price: 0,
    fallbackPrice: { amount: 0, currency: "USD", symbol: "$" },
    features: [
      { title: "Unlimited text translation", included: true },
      { title: "Voice dictation (up to 2 min)", included: true },
      { title: "Auto-copy translations", included: true },
      { title: "30-day cloud history", included: true },
      { title: "Auto-detect spoken language", included: true },
      { title: "Custom avatar icons", included: false },
      { title: "Ad-free experience", included: false },
      { title: "Extended voice dictation (up to 20 min)", included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Pro",
    tagline: "Zero distractions. Full power.",
    productIdMonthly: "ekwe_pro_monthly",
    productIdAnnual: "ekwe_pro_annual",
    features: [
      { title: "Ad-free experience", included: true },
      { title: "Extended voice dictation (up to 20 min)", included: true },
      { title: "1-year cloud history", included: true },
      { title: "Priority AI context processing", included: true },
      { title: "Custom avatar icons", included: true },
    ] as PlanFeature[],
  },
} as const;
