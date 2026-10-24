import { logger } from "@/core/logger";
import { Env } from "@/core/types";
import {
  computeSavingPercent,
  DEFAULT_PAYMENT_CURRENCY,
  isSupportedPaymentCurrency,
  resolvePaymentCurrency,
  roundToCurrency,
} from "@ekwe/shared/money";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";
import { LocalPrice, LOCAL_PRICES } from "@ekwe/shared/plans";
import { storePricingResponseSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { withCache } from "@/core/cache";
import { describeError, retryTransient } from "@/db/retry";

export interface LocalPlanPrices {
  currency: FlutterwaveCurrency;
  monthly: number;
  annual: number;
  monthlyUsd: number;
  annualUsd: number;
}

interface SubscriptionConfig {
  basePriceUsd: number;
  discountPercent: number;
  annualDiscountPercent: number;
  localPrices: Record<string, LocalPrice>;
}

interface AppConfigRow {
  base_price_usd: number;
  discount_percent: number;
  annual_discount_percent: number;
  local_prices: string;
}

const CONFIG_CACHE_TTL_MS = 10_000;

const DEFAULT_CONFIG: SubscriptionConfig = {
  basePriceUsd: 2.23,
  discountPercent: 0,
  annualDiscountPercent: 20,
  localPrices: {},
};

type ConfigLoad =
  | { kind: "loaded"; config: SubscriptionConfig }
  | { kind: "missing" }
  | { kind: "unreachable" };

let configCache: { load: ConfigLoad; expiresAt: number } | null = null;

export function resetPricingCache(): void {
  configCache = null;
}

function toFinite(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseLocalPrices(raw: unknown): Record<string, LocalPrice> {
  const parsed: Record<string, LocalPrice> = {};
  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return parsed;
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return parsed;
  }

  for (const [code, value] of Object.entries(decoded)) {
    const normalizedCode = code.toUpperCase();
    if (
      !isSupportedPaymentCurrency(normalizedCode) ||
      !value ||
      typeof value !== "object"
    )
      continue;
    const v = value as Record<string, unknown>;
    const monthly = toFinite(v.monthly, NaN);
    const annual = toFinite(v.annual, NaN);
    if (!Number.isFinite(monthly) || !Number.isFinite(annual)) continue;
    if (monthly <= 0 || annual <= 0) continue;
    parsed[normalizedCode] = { monthly, annual };
  }

  return parsed;
}

async function loadSubscriptionConfig(
  env: Env,
  forceReload = false,
): Promise<ConfigLoad> {
  if (!forceReload && configCache && configCache.expiresAt > Date.now()) {
    return configCache.load;
  }

  let load: ConfigLoad;
  try {
    const row = await retryTransient(() =>
      env.DB.prepare(
        `SELECT base_price_usd, discount_percent, annual_discount_percent, local_prices
           FROM app_config WHERE id = 1`,
      ).first<AppConfigRow>(),
    );

    if (!row) {
      logger.warn("[pricing] No app_config row");
      load = { kind: "missing" };
    } else {
      load = {
        kind: "loaded",
        config: {
          basePriceUsd: toFinite(
            row.base_price_usd,
            DEFAULT_CONFIG.basePriceUsd,
          ),
          discountPercent: toFinite(
            row.discount_percent,
            DEFAULT_CONFIG.discountPercent,
          ),
          annualDiscountPercent: toFinite(
            row.annual_discount_percent,
            DEFAULT_CONFIG.annualDiscountPercent,
          ),
          localPrices: parseLocalPrices(row.local_prices),
        },
      };
    }
  } catch (error) {
    logger.error("[pricing] Failed to load subscription config", {
      error: describeError(error),
    });
    load = { kind: "unreachable" };
  }

  if (load.kind === "loaded") {
    configCache = { load, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  }
  return load;
}

async function getSubscriptionConfig(env: Env): Promise<SubscriptionConfig> {
  const load = await loadSubscriptionConfig(env);
  return load.kind === "loaded" ? load.config : DEFAULT_CONFIG;
}

export async function getAuthoritativePlanPrices(
  env: Env,
  currency: string,
): Promise<LocalPlanPrices | null> {
  const code = resolvePaymentCurrency(currency);
  const load = await loadSubscriptionConfig(env, true);
  if (load.kind !== "loaded") return null;
  const local = load.config.localPrices[code];
  if (!local) return null;
  const usd = load.config.localPrices.USD;
  return {
    currency: code,
    monthly: local.monthly,
    annual: local.annual,
    monthlyUsd: usd?.monthly ?? LOCAL_PRICES.USD.monthly,
    annualUsd: usd?.annual ?? LOCAL_PRICES.USD.annual,
  };
}

export function resolveRequestCurrency(
  explicit: string | undefined,
): FlutterwaveCurrency {
  return explicit ? resolvePaymentCurrency(explicit) : DEFAULT_PAYMENT_CURRENCY;
}

export async function handleStorePricing(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(
    request,
    ctx,
    async () => {
      const currency = resolveRequestCurrency(
        new URL(request.url).searchParams.get("currency") ?? undefined,
      );

      const config = await getSubscriptionConfig(env);
      const code = resolvePaymentCurrency(currency);
      const local = config.localPrices[code] ?? LOCAL_PRICES[code];
      const usd = config.localPrices.USD ?? LOCAL_PRICES.USD;

      const body = {
        currency: code,
        price: local.monthly,
        usd: usd.monthly,
        originalPriceUsd: config.basePriceUsd,
        discountPercent: config.discountPercent,
        annualPrice: local.annual,
        annualUsd: usd.annual,
        originalAnnualUsd: roundToCurrency(config.basePriceUsd * 12, "USD"),
        annualDiscountPercent: computeSavingPercent(
          local.monthly,
          local.annual,
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
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      });
    },
    60,
  );
}
