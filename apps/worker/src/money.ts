import { getCurrency } from "@ekwe/shared/currencies";
import { SUPPORTED_CURRENCY_CODES } from "@ekwe/shared/currencies";
import { logger } from "./logger";
import { Env } from "./types";

const CACHE_KEY_FX = "fx:USD";
const FX_TTL = 3600;
const MEM_TTL = 60_000;

let memRates: { rates: Record<string, number>; ts: number } | null = null;

export async function getRates(
  env: Env,
): Promise<Record<string, number> | null> {
  if (memRates && Date.now() - memRates.ts < MEM_TTL) {
    return memRates.rates;
  }

  const cached = await env.EKWE_KV.get(CACHE_KEY_FX);
  if (cached) {
    try {
      const p = JSON.parse(cached) as {
        rates: Record<string, number>;
        ts: number;
      };
      memRates = p;
      return p.rates;
    } catch {
      /* corrupt cache */
    }
  }

  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json<{ rates: Record<string, number> }>();
    const entry = { rates: data.rates, ts: Date.now() };
    await env.EKWE_KV.put(CACHE_KEY_FX, JSON.stringify(entry), {
      expirationTtl: FX_TTL,
    });
    memRates = entry;
    return data.rates;
  } catch (err) {
    logger.error("[money] FX fetch failed", { error: String(err) });
    return null;
  }
}

export function getSupportedCurrencies(): string[] {
  return [...SUPPORTED_CURRENCY_CODES];
}

export function getRateFor(
  currency: string,
  rates: Record<string, number> | null,
): number {
  const c = currency.toUpperCase();
  const fallback = getCurrency(c)?.fallbackRate ?? 1;
  return rates?.[c] ?? fallback;
}
