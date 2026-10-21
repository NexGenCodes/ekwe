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

const dailyCaps = (translate: number, transcribe: number): string =>
  translate === 0 && transcribe === 0
    ? "Unlimited translations & transcriptions"
    : `${fmtInt(translate)} translations & ${fmtInt(transcribe)} transcriptions per day`;

const speechFeature = (limits: PlanLimits): string => {
  if (limits.dailySpeechCharsLimit === 0) return "No text-to-speech";
  const voices =
    limits.speechQuality === "premium"
      ? "Standard + Studio voices"
      : "Standard voice";
  return `${voices} · ${fmtInt(limits.dailySpeechCharsLimit)} speech characters/day`;
};

const contentLimits = (limits: PlanLimits): string =>
  `${fmtInt(limits.maxTextChars)}-char texts · voice notes up to ${fmtMinutes(
    limits.dictationDurationMs,
  )} · audio uploads up to ${fmtMB(limits.maxAudioBytes)}`;

const liveDictation = (limits: PlanLimits): string =>
  limits.maxStreamDurationMs > 0
    ? `Live dictation · up to ${fmtMinutes(
        limits.maxStreamDurationMs,
      )}/session, ${fmtInt(limits.dailyStreamLimit)} sessions/day, ${fmtInt(
        limits.maxConcurrentStreams,
      )} at once`
    : "Live dictation";

export const BILLING_PLANS = {
  free: {
    id: "free" as const,
    name: "Free",
    tagline: "Core translation tools at no cost.",
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
      { title: "Automatic language detection", included: false },
      { title: "Live dictation", included: false },
      { title: "Romanized readings for non-Latin scripts", included: false },
      { title: "Custom avatar icons", included: false },
      { title: "Auto-copy translations", included: false },
    ] as PlanFeature[],
  },
  pro: {
    id: "pro" as const,
    name: "Pro",
    tagline: "Unlimited translation, live dictation, and Studio voices.",
    features: [
      {
        title: dailyCaps(
          PLAN_LIMITS.pro.dailyTranslateLimit,
          PLAN_LIMITS.pro.dailyTranscribeLimit,
        ),
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
