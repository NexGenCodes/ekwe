import { logger } from "./logger";
import { Env } from "./types";

const CACHE_KEY_FX = "fx:USD";
const FX_TTL = 3600;
const MEM_TTL = 60_000;

export const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  NGN: 1000,
  GBP: 1,
  EUR: 1,
  GHS: 14,
  KES: 140,
  ZAR: 18,
  EGP: 48,
  XOF: 600,
  INR: 80,
};

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2, NGN: 2, GBP: 2, EUR: 2,
  GHS: 2, KES: 2, ZAR: 2, EGP: 2,
  XOF: 0, INR: 2,
};

let memRates: { rates: Record<string, number>; ts: number } | null = null;

function getDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function roundToCurrency(amount: number, currency: string): number {
  const d = getDecimals(currency);
  return Math.round(amount * 10 ** d) / 10 ** d;
}

export function toLowestUnit(amount: number, currency: string): number {
  return Math.round(amount * 10 ** getDecimals(currency));
}

export async function getRates(env: Env): Promise<Record<string, number> | null> {
  if (memRates && Date.now() - memRates.ts < MEM_TTL) {
    return memRates.rates;
  }

  const cached = await env.EKWE_KV.get(CACHE_KEY_FX);
  if (cached) {
    try {
      const p = JSON.parse(cached) as { rates: Record<string, number>; ts: number };
      memRates = p;
      return p.rates;
    } catch { /* corrupt cache */ }
  }

  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { rates: Record<string, number> };
    const entry = { rates: data.rates, ts: Date.now() };
    await env.EKWE_KV.put(CACHE_KEY_FX, JSON.stringify(entry), { expirationTtl: FX_TTL });
    memRates = entry;
    return data.rates;
  } catch (err) {
    logger.error("[money] FX fetch failed", { error: String(err) });
    return null;
  }
}

export function getSupportedCurrencies(): string[] {
  return Object.keys(FALLBACK_RATES);
}

export function getRateFor(currency: string, rates: Record<string, number> | null): number {
  const c = currency.toUpperCase();
  return rates?.[c] ?? FALLBACK_RATES[c] ?? 1;
}
