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
const fmtMB = (bytes: number): string => `${Math.round(bytes / 1_048_576)} MB`;
const fmtHistory = (days: number): string =>
  days % 365 === 0 ? `${days / 365}-year` : `${days}-day`;

const dailyCaps = (limits: PlanLimits): string =>
  `${fmtInt(limits.dailyTranslateLimit)} translations/day · ${fmtInt(
    limits.dailyTranscribeMinutesLimit,
  )} transcription min/day`;

const monthlyCaps = (limits: PlanLimits): string =>
  `${fmtInt(limits.monthlyTranslateLimit)} translations/month · ${fmtInt(
    limits.monthlyTranscribeMinutesLimit,
  )} transcription min/month`;

const sharedBudget = (limits: PlanLimits): string =>
  `${fmtInt(limits.monthlyAiCreditsLimit)} shared AI credits/month`;

const speechFeature = (limits: PlanLimits): string => {
  const voices =
    limits.speechQuality === "premium"
      ? "Standard + Studio voices"
      : "Standard voice";
  return limits.dailySpeechCharsLimit > 0
    ? `${voices} · ${fmtInt(limits.dailySpeechCharsLimit)} speech chars/day`
    : `${voices} · No speech on this plan`;
};

const contentLimits = (limits: PlanLimits): string =>
  `${fmtInt(limits.maxTextChars)}-char texts · voice notes up to ${fmtMinutes(
    limits.dictationDurationMs,
  )} · audio uploads up to ${fmtMB(limits.maxAudioBytes)}`;

const liveDictation = (limits: PlanLimits): string => {
  if (limits.maxStreamDurationMs <= 0) return "Live dictation";
  const sessionCap = `${fmtInt(limits.dailyStreamLimit)} sessions/day`;
  return `Live dictation · up to ${fmtMinutes(
    limits.maxStreamDurationMs,
  )}/session, ${sessionCap}, ${fmtInt(
    limits.monthlyStreamMinutesLimit,
  )} min/month, ${fmtInt(limits.maxConcurrentStreams)} at once`;
};

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Free",
    tagline: "Core translation tools, supported by ads.",
    price: 0,
    features: [
      {
        title: dailyCaps(PLAN_LIMITS.free),
        included: true,
      },
      {
        title: monthlyCaps(PLAN_LIMITS.free),
        included: true,
      },
      {
        title: sharedBudget(PLAN_LIMITS.free),
        included: true,
      },
      {
        title: contentLimits(PLAN_LIMITS.free),
        included: true,
      },
      {
        title: speechFeature(PLAN_LIMITS.free),
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.free.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "Ad-supported", included: true },
      { title: "Automatic language detection", included: false },
      { title: "Live dictation", included: false },
      { title: "Romanized readings for non-Latin scripts", included: false },
      { title: "Custom avatar icons", included: false },
      { title: "Auto-copy translations", included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Paid",
    tagline: "More translation, transcription, and no ads.",
    features: [
      {
        title: dailyCaps(PLAN_LIMITS.pro),
        included: true,
      },
      {
        title: monthlyCaps(PLAN_LIMITS.pro),
        included: true,
      },
      {
        title: sharedBudget(PLAN_LIMITS.pro),
        included: true,
      },
      {
        title: contentLimits(PLAN_LIMITS.pro),
        included: true,
      },
      {
        title: speechFeature(PLAN_LIMITS.pro),
        included: true,
      },
      {
        title: `${fmtHistory(PLAN_LIMITS.pro.historyRemoteTtlDays)} cloud history`,
        included: true,
      },
      { title: "No ads", included: true },
      { title: "Automatic language detection", included: true },
      {
        title: liveDictation(PLAN_LIMITS.pro),
        included: true,
      },
      { title: "Romanized readings for non-Latin scripts", included: true },
      { title: "Custom avatar icons", included: true },
      { title: "Auto-copy translations", included: true },
    ] as PlanFeature[],
  },
} as const;
