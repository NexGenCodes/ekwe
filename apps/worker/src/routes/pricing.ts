import { logger } from "../core/logger";
import { Env } from "../core/types";
import { getRates, getRateFor } from "../services/money";
import { roundToCurrency } from "@ekwe/shared/money";
import { storePricingResponseSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { supabaseGet } from "../services/supabase";
import { withCache } from "../core/cache";

/**
 * ─── GET /pricing?currency=NGN ─────────────────────────────────────
 *
 * Store-ready, display-only pricing. Reads the global subscription_config
 * row (base USD price + discount_percent + annual_discount_percent), applies
 * the discounts in USD, then converts to the caller's currency via the cached
 * FX table. Omit/invalidate `currency` to get USD pricing.
 *
 * The discounts are a UI concern only: the store always charges the product's
 * list price (real discounts = Play/App Store offers or promo codes). The
 * response is promo-code-ready — a future code lookup folds into
 * `discountPercent` and the client already renders the strikethrough
 * `originalPriceUsd`/`originalAnnualUsd`.
 */

interface SubscriptionConfig {
  basePriceUsd: number;
  discountPercent: number;
  annualDiscountPercent: number;
}

const DEFAULT_CONFIG: SubscriptionConfig = {
  basePriceUsd: 2.0,
  discountPercent: 0,
  annualDiscountPercent: 20,
};

const CONFIG_CACHE_TTL_MS = 10_000;
const CONFIG_PATH =
  "/rest/v1/subscription_config?id=eq.1&select=base_price_usd,discount_percent,annual_discount_percent";

let memConfig: { config: SubscriptionConfig; ts: number } | null = null;

/** Test-only: drop the 10s config cache so tests run against fresh state. */
export function resetPricingCache(): void {
  memConfig = null;
}

async function getSubscriptionConfig(env: Env): Promise<SubscriptionConfig> {
  if (memConfig && Date.now() - memConfig.ts < CONFIG_CACHE_TTL_MS) {
    return memConfig.config;
  }

  try {
    const res = await supabaseGet(env, CONFIG_PATH);
    if (!res || !res.ok) {
      logger.error("[pricing] Failed to read subscription_config", {
        status: res?.status ?? "unconfigured",
      });
      memConfig = { config: DEFAULT_CONFIG, ts: Date.now() };
      return DEFAULT_CONFIG;
    }

    const data: unknown = await res.json();
    const rows = data as Array<{
      base_price_usd?: string | number;
      discount_percent?: string | number;
      annual_discount_percent?: string | number;
    }>;
    const row = rows[0];

    const config: SubscriptionConfig = {
      basePriceUsd:
        Number(row?.base_price_usd ?? DEFAULT_CONFIG.basePriceUsd) ||
        DEFAULT_CONFIG.basePriceUsd,
      discountPercent:
        Number(row?.discount_percent ?? DEFAULT_CONFIG.discountPercent) || 0,
      annualDiscountPercent:
        Number(row?.annual_discount_percent ?? DEFAULT_CONFIG.annualDiscountPercent) ||
        DEFAULT_CONFIG.annualDiscountPercent,
    };
    memConfig = { config, ts: Date.now() };
    return config;
  } catch (err) {
    logger.error("[pricing] subscription_config read error", {
      error: err instanceof Error ? err.message : String(err),
    });
    memConfig = { config: DEFAULT_CONFIG, ts: Date.now() };
    return DEFAULT_CONFIG;
  }
}

/**
 * Computes the monthly + annual local prices for a currency from the single
 * source of truth (subscription_config USD base + discounts) converted
 * through the cached FX table. Shared by GET /pricing and POST /billing/checkout
 * so the price the Flutterwave checkout charges is always identical to the
 * price the pricing endpoint reported.
 */
export interface LocalPlanPrices {
  currency: string;
  monthly: number;
  annual: number;
  monthlyUsd: number;
  annualUsd: number;
  /** False when the FX table is unavailable and rates fell back to 1. */
  fxAvailable: boolean;
}

export async function getLocalPlanPrices(
  env: Env,
  currency: string,
): Promise<LocalPlanPrices> {
  const config = await getSubscriptionConfig(env);

  // Monthly: base price with the global/promo discount applied.
  const monthlyUsd = roundToCurrency(
    config.basePriceUsd * (1 - config.discountPercent / 100),
    "USD",
  );

  // Annual: monthly × 12, then the annual discount on top. Computed from the
  // discounted monthly so a global campaign compounds across both periods.
  const annualUsd = roundToCurrency(
    monthlyUsd * 12 * (1 - config.annualDiscountPercent / 100),
    "USD",
  );

  const rates = await getRates(env);
  const rate = getRateFor(currency, rates);

  return {
    currency,
    monthly: roundToCurrency(monthlyUsd * rate, currency),
    annual: roundToCurrency(annualUsd * rate, currency),
    monthlyUsd,
    annualUsd,
    fxAvailable: rates !== null,
  };
}

export async function handleStorePricing(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(request, ctx, async () => {
    const url = new URL(request.url);
    const requested = (url.searchParams.get("currency") ?? "").toUpperCase();
    const currency = /^[A-Z]{3}$/.test(requested) ? requested : "USD";

    const prices = await getLocalPlanPrices(env, currency);

    // If FX is down, a non-USD currency would silently render USD amounts as
    // local prices (rate falls back to 1). Signal the client to fall back to
    // USD explicitly instead of showing a wrong local price.
    if (currency !== "USD" && !prices.fxAvailable) {
      return Response.json(
        {
          error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Currency conversion unavailable, request USD instead",
        },
        { status: 503 },
      );
    }

    const config = await getSubscriptionConfig(env);

    const body = {
      currency: prices.currency,
      price: prices.monthly,
      usd: prices.monthlyUsd,
      originalPriceUsd: config.basePriceUsd,
      discountPercent: config.discountPercent,
      annualPrice: prices.annual,
      annualUsd: prices.annualUsd,
      originalAnnualUsd: roundToCurrency(config.basePriceUsd * 12, "USD"),
      annualDiscountPercent: Math.round(
        (1 - prices.annualUsd / (prices.monthlyUsd * 12)) * 100,
      ),
    };

    const parsed = storePricingResponseSchema.safeParse(body);
    if (!parsed.success) {
      logger.error("[pricing] Internal response failed schema", {
        error: parsed.error.message,
      });
      return Response.json(
        {
          error: WORKER_ERROR_CODES.SERVER_ERROR,
          message: "An internal error occurred",
        },
        { status: 500 },
      );
    }

    return Response.json(parsed.data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  }, 60);
}