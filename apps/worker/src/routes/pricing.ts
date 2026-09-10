import { logger } from "../core/logger";
import { Env } from "../core/types";
import {
  computeSavingPercent,
  countryToCurrency,
  resolvePaymentCurrency,
  roundToCurrency,
} from "@ekwe/shared/money";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";
import { LocalPrice, LOCAL_PRICES } from "@ekwe/shared/plans";
import { storePricingResponseSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { withCache } from "../core/cache";
import { supabaseGet } from "../services/supabase";

/**
 * ─── GET /pricing?currency=NGN ─────────────────────────────────────
 *
 * Store-ready, display-only pricing. Reads the single `subscription_config`
 * row (base price + `local_prices` per currency) from Supabase and resolves
 * unsupported or unknown currencies to USD. Omit/invalidate `currency` to get
 * USD pricing.
 *
 * Flutterwave does NOT auto-convert: the merchant must send `amount` +
 * `currency`, and the customer's card is charged in that currency. So the
 * prices here are static "price tiers" (like App Store/Play tiers) and the
 * amount POST /billing/checkout charges is always identical to what this
 * endpoint reports — display == charge, deterministic and offline-capable.
 * The DB row is the source of truth; `LOCAL_PRICES` in @ekwe/shared is only
 * the fallback when Supabase is unreachable (kept in sync with the seed).
 *
 * The USD fields (`usd`, `originalPriceUsd`, `annualUsd`, `originalAnnualUsd`)
 * are a reference anchor for cross-currency comparisons and strikethrough
 * rendering; `discountPercent` is always 0 because prices are flat (no promo
 * code support yet). The annual price bakes in the ~20% discount, reported via
 * `annualDiscountPercent`.
 */

export interface LocalPlanPrices {
  currency: string;
  monthly: number;
  annual: number;
  monthlyUsd: number;
  annualUsd: number;
}

interface SubscriptionConfigRow {
  base_price_usd?: number | null;
  discount_percent?: number | null;
  annual_discount_percent?: number | null;
  local_prices?: unknown;
}

interface SubscriptionConfig {
  basePriceUsd: number;
  discountPercent: number;
  annualDiscountPercent: number;
  localPrices: Record<string, LocalPrice>;
}

/** Path selecting every pricing field the worker needs from the config row. */
const SUBSCRIPTION_CONFIG_PATH =
  "/rest/v1/subscription_config?id=eq.1&select=base_price_usd,discount_percent,annual_discount_percent,local_prices";

/** How long a loaded config is reused before re-reading Supabase (10s). */
const CONFIG_CACHE_TTL_MS = 10_000;

/**
 * Fallback used when Supabase is unavailable or the row is missing. Mirrors
 * the seed row so fallback pricing == DB pricing. `localPrices` empty means
 * `LOCAL_PRICES` in @ekwe/shared supplies the per-currency amounts.
 */
const DEFAULT_CONFIG: SubscriptionConfig = {
  basePriceUsd: 2.23,
  discountPercent: 0,
  annualDiscountPercent: 20,
  localPrices: {},
};

/**
 * Outcome of a config read from Supabase. `loaded` means the row was read;
 * `missing` means Supabase responded but there is no row; `unreachable` means
 * the read failed (network / non-ok). Display pricing treats `missing` and
 * `unreachable` the same (bundled defaults), but the webhook's grant path
 * only ever trusts `loaded` prices.
 */
type ConfigLoad =
  | { kind: "loaded"; config: SubscriptionConfig }
  | { kind: "missing" }
  | { kind: "unreachable" };

let configCache: { load: ConfigLoad; expiresAt: number } | null = null;

/** Test-only: drops the cached config so the next call re-reads Supabase. */
export function resetPricingCache(): void {
  configCache = null;
}

function toFinite(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Validates a jsonb `local_prices` map into `{ code: { monthly, annual } }`,
 * dropping malformed entries. Accepts the wire format directly (numbers or
 * numeric strings).
 */
function parseLocalPrices(raw: unknown): Record<string, LocalPrice> {
  const parsed: Record<string, LocalPrice> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return parsed;

  for (const [code, value] of Object.entries(raw)) {
    if (!/^[A-Z]{3}$/.test(code) || !value || typeof value !== "object")
      continue;
    const v = value as Record<string, unknown>;
    const monthly = toFinite(v.monthly, NaN);
    const annual = toFinite(v.annual, NaN);
    if (!Number.isFinite(monthly) || !Number.isFinite(annual)) continue;
    if (monthly <= 0 || annual <= 0) continue;
    parsed[code] = { monthly, annual };
  }

  return parsed;
}

/** Reads and (briefly) caches the subscription config row from Supabase. */
async function loadSubscriptionConfig(
  env: Env,
  forceReload = false,
): Promise<ConfigLoad> {
  if (!forceReload && configCache && configCache.expiresAt > Date.now()) {
    return configCache.load;
  }

  let load: ConfigLoad;
  try {
    const res = await supabaseGet(env, SUBSCRIPTION_CONFIG_PATH);
    if (!res || !res.ok) {
      logger.warn("[pricing] Subscription config unavailable", {
        status: res?.status ?? "unconfigured",
      });
      load = { kind: "unreachable" };
    } else {
      const rows: SubscriptionConfigRow[] = await res.json();
      const row = rows[0];
      if (!row) {
        logger.warn("[pricing] No subscription_config row");
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
    }
  } catch (error) {
    logger.error("[pricing] Failed to load subscription config", {
      error: error instanceof Error ? error.message : String(error),
    });
    load = { kind: "unreachable" };
  }

  // Only cache successful loads so transient failures recover immediately
  if (load.kind === "loaded") {
    configCache = { load, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  }
  return load;
}

/**
 * The config for display pricing. Falls back to bundled defaults when
 * Supabase is unreachable or the row is missing, so GET /pricing and checkout
 * stay offline-capable.
 */
async function getSubscriptionConfig(env: Env): Promise<SubscriptionConfig> {
  const load = await loadSubscriptionConfig(env);
  return load.kind === "loaded" ? load.config : DEFAULT_CONFIG;
}

/**
 * Resolves the monthly + annual local prices for a currency. Shared by GET
 * /pricing and POST /billing/checkout so the price the Flutterwave checkout
 * charges is always identical to the price the pricing endpoint reported.
 * DB `local_prices` wins; the shared map is the fallback.
 */
async function getLocalPlanPrices(
  env: Env,
  currency: string,
): Promise<LocalPlanPrices> {
  const code = resolvePaymentCurrency(currency);
  const config = await getSubscriptionConfig(env);

  const local = config.localPrices[code] ?? LOCAL_PRICES[code];
  const usd = config.localPrices.USD ?? LOCAL_PRICES.USD;

  return {
    currency: code,
    monthly: local.monthly,
    annual: local.annual,
    monthlyUsd: usd.monthly,
    annualUsd: usd.annual,
  };
}

/**
 * The monthly + annual price for a currency, read strictly from the Supabase
 * `subscription_config` row — never from the bundled map. Returns null when
 * Supabase cannot confirm it (unreachable, no row, or the currency has no
 * price in the row). The webhook uses this so a Pro grant only ever happens
 * against a price read from Supabase; the bundled `LOCAL_PRICES` mirror (also
 * embedded in the mobile bundle for display) can never influence a grant.
 */
export async function getAuthoritativePlanPrices(
  env: Env,
  currency: string,
): Promise<LocalPlanPrices | null> {
  const code = resolvePaymentCurrency(currency);
  // Authoritative reads should always fetch fresh data from the DB to avoid
  // granting access against stale prices or cached outage states.
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

/**
 * Resolves the billing currency for a request. Order of precedence:
 *
 *   1. Explicit client currency (manual selection) — always wins.
 *   2. The request's geo country via Cloudflare's `CF-IPCountry` header,
 *      mapped to a billable currency. This is the battle-tested signal for
 *      "where the user actually is": device locales misreport region on
 *      Android (e.g. an English-US phone in Nigeria reports USD), so we trust
 *      the network's authoritative geo instead of the client when the user
 *      hasn't picked a currency themselves.
 *   3. Unsupported/absent → USD (our global default), so pricing + checkout
 *      stay deterministic.
 *
 * Shared by GET /pricing and POST /billing/checkout so the displayed price
 * always matches the charged amount in the same resolved currency.
 */
export function resolveRequestCurrency(
  explicit: string | undefined,
  request?: Request,
): FlutterwaveCurrency {
  if (explicit) return resolvePaymentCurrency(explicit);

  const geo = request?.headers.get("CF-IPCountry");
  if (geo) {
    const fromCountry = countryToCurrency(geo);
    if (fromCountry) return resolvePaymentCurrency(fromCountry);
  }

  return "USD";
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
        request,
      );

      const prices = await getLocalPlanPrices(env, currency);
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
        annualDiscountPercent: computeSavingPercent(
          prices.monthly,
          prices.annual,
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
