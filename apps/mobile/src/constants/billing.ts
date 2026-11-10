import {
  FREE_FEATURES,
  FREE_LIMITS,
  PREMIUM_FEATURES,
  PREMIUM_LIMITS,
} from "@ekwe/shared/plans";
import type {
  PlanFeatures as SharedPlanFeatures,
  PlanLimits as SharedPlanLimits,
} from "@ekwe/shared/plans";

export type PlanLimits = SharedPlanLimits;

export const PLAN_LIMITS: { free: PlanLimits; pro: PlanLimits } = {
  free: FREE_LIMITS,
  pro: PREMIUM_LIMITS,
};

export const PLAN_FEATURES: {
  free: SharedPlanFeatures;
  pro: SharedPlanFeatures;
} = {
  free: FREE_FEATURES,
  pro: PREMIUM_FEATURES,
};

export interface PlanFeature {
  title: string;
  included: boolean;
}

const fmtInt = (n: number): string => n.toLocaleString("en-US");
const fmtMinutes = (ms: number): string => `${Math.round(ms / 60_000)} min`;
const fmtHistory = (days: number): string =>
  days % 365 === 0 ? `${days / 365}-year` : `${days}-day`;

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Free",
    tagline: "Core translation tools with daily limits.",
    price: 0,
    features: [
      {
        title: `${fmtInt(PLAN_LIMITS.free.dailyTranslateLimit)} translations per day`,
        included: true,
      },
      {
        title: `${fmtInt(PLAN_LIMITS.free.dailyTranscribeMinutesLimit)} minutes transcription per day`,
        included: true,
      },
      {
        title: "Standard voices (2,000 chars/day)",
        included: true,
      },
      {
        title: `Voice notes up to ${fmtMinutes(PLAN_LIMITS.free.dictationDurationMs)}`,
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.free.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "Automatic language detection", included: false },
      { title: "Live dictation", included: false },
      { title: "Custom avatar icons", included: false },
      { title: "Auto-copy translations", included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Premium",
    tagline:
      "Unlimited translation and transcription, plus higher speech and live limits.",
    features: [
      {
        title: "Unlimited translations",
        included: true,
      },
      {
        title: "Unlimited audio transcription",
        included: true,
      },
      {
        title: `${fmtInt(PLAN_LIMITS.pro.monthlySpeechCharsLimit)} speech chars/month with Studio voices`,
        included: true,
      },
      {
        title: "No daily usage caps",
        included: true,
      },
      {
        title: `Live dictation (${fmtMinutes(PLAN_LIMITS.pro.maxStreamDurationMs)}/session, ${fmtInt(PLAN_LIMITS.pro.monthlyStreamMinutesLimit)} min/month)`,
        included: true,
      },
      {
        title: `Voice notes up to ${fmtMinutes(PLAN_LIMITS.pro.dictationDurationMs)}`,
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.pro.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "Automatic language detection", included: true },
      { title: "Custom avatar icons", included: true },
      { title: "Auto-copy translations", included: true },
    ] as PlanFeature[],
  },
} as const;
