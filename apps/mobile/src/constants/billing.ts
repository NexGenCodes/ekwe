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

/** Combined daily caps: "25 translations & 25 transcriptions per day". */
const dailyCaps = (translate: number, transcribe: number): string =>
  translate === 0 && transcribe === 0
    ? "Unlimited translations & transcriptions"
    : `${fmtInt(translate)} translations & ${fmtInt(transcribe)} transcriptions per day`;

/** Premium speech cap: "Premium speech · 256 chars/day". */
const speechCap = (chars: number): string =>
  chars === 0
    ? "No text-to-speech"
    : `Premium speech · ${fmtInt(chars)} chars/day`;

/** Combined content limits: "3,000-char texts & voice notes up to 2 min". */
const contentLimits = (textChars: number, durationMs: number): string =>
  `${fmtInt(textChars)}-char texts & voice notes up to ${fmtMinutes(durationMs)}`;

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Free",
    tagline: "The essential translation experience — free forever",
    price: 0,
    features: [
      {
        title: dailyCaps(
          PLAN_LIMITS.free.dailyTranslateLimit,
          PLAN_LIMITS.free.dailyTranscribeLimit,
        ),
        included: true,
      },
      {
        title: contentLimits(
          PLAN_LIMITS.free.maxTextChars,
          PLAN_LIMITS.free.dictationDurationMs,
        ),
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.free.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "Auto-copy translations", included: true },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Pro",
    tagline: "Zero distractions. Full power.",
    features: [
      {
        title: dailyCaps(
          PLAN_LIMITS.pro.dailyTranslateLimit,
          PLAN_LIMITS.pro.dailyTranscribeLimit,
        ),
        included: true,
      },
      {
        title: contentLimits(
          PLAN_LIMITS.pro.maxTextChars,
          PLAN_LIMITS.pro.dictationDurationMs,
        ),
        included: true,
      },
      { title: "Live dictation with auto-detect", included: true },
      { title: "Ad-free experience", included: true },
      {
        title: speechCap(PLAN_LIMITS.pro.dailyTtsCharsLimit),
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.pro.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "Auto-copy translations", included: true },
    ] as PlanFeature[],
  },
} as const;
