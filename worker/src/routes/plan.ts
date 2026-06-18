import { Env } from "../types";
import { getRates, getRateFor, roundToCurrency, toLowestUnit, FALLBACK_RATES } from "../money";

interface PriceDetail {
  amount: number;
  currency: string;
  lowestUnit: number;
}

interface PlanPricing {
  monthly: PriceDetail;
  annual: PriceDetail;
}

type PricingTable = Record<string, PlanPricing>;

const USD_PRICE = { monthly: { amount: 3.00, currency: 'USD', lowestUnit: 300 }, annual: { amount: 28.80, currency: 'USD', lowestUnit: 2880 } };

const PLAN_CONFIG = {
  plans: {
    FREE: {
      limits: {
        maxAudioBytes: 4_194_304,
        maxTextChars: 3_000,
        autoDetectAllowed: false,
        dictationDurationMs: 120_000,
        historyRemoteTtlDays: 30,
        streamingAllowed: false,
        transliterationAllowed: false,
        contextAwareness: false,
        customAvatarIcons: false,
        maxTargetLanguages: 1,
        exportFormats: ['text'] as readonly string[],
        ttsQuality: 'standard' as const,
        cooldownSeconds: 3,
      },
      features: {
        autoCopy: true,
      },
    },
    PREMIUM: {
      limits: {
        maxAudioBytes: 26_214_400,
        maxTextChars: 10_000,
        autoDetectAllowed: true,
        dictationDurationMs: 1_200_000,
        historyRemoteTtlDays: 365,
        streamingAllowed: true,
        transliterationAllowed: true,
        contextAwareness: true,
        customAvatarIcons: true,
        maxTargetLanguages: 3,
        exportFormats: ['text', 'pdf', 'srt'] as readonly string[],
        ttsQuality: 'premium' as const,
        cooldownSeconds: 1,
      },
      features: {
        autoCopy: true,
      },
    },
  },
} as const;

function buildPricing(rates: Record<string, number> | null): PricingTable {
  const supported = Object.keys(FALLBACK_RATES);
  const pricing: PricingTable = { USD: USD_PRICE };
  for (const currency of supported) {
    if (currency === 'USD') continue;
    const rate = getRateFor(currency, rates);
    const monthlyAmount = roundToCurrency(USD_PRICE.monthly.amount * rate, currency);
    const annualAmount = roundToCurrency(USD_PRICE.annual.amount * rate, currency);
    pricing[currency] = {
      monthly: { amount: monthlyAmount, currency, lowestUnit: toLowestUnit(monthlyAmount, currency) },
      annual: { amount: annualAmount, currency, lowestUnit: toLowestUnit(annualAmount, currency) },
    };
  }
  return pricing;
}

export async function handlePlan(env: Env): Promise<Response> {
  const rates = await getRates(env);
  return Response.json({
    limits: {
      FREE: PLAN_CONFIG.plans.FREE.limits,
      PREMIUM: PLAN_CONFIG.plans.PREMIUM.limits,
    },
    features: {
      FREE: PLAN_CONFIG.plans.FREE.features,
      PREMIUM: PLAN_CONFIG.plans.PREMIUM.features,
    },
    pricing: buildPricing(rates),
  });
}
