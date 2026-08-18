import { logger } from "../core/logger";
import { Env } from "../core/types";

const CACHE_KEY_FX = "fx:USD";
const FX_TTL = 3600;
const MEM_TTL = 60_000;

let memRates: { rates: Record<string, number>; ts: number } | null = null;

/** Test-only: drop the 60s FX mem cache so tests run against fresh state. */
export function resetFxCache(): void {
  memRates = null;
}

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
    // open.er-api.com: free, no key, covers ~160 currencies (Frankfurter/ECB
    // lacks NGN, GHS, KES, EGP, XOF, INR so those silently fell back to
    // static rates). Any currency is fair game, so the app supports every
    // currency the stores bill in.
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
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

export function getRateFor(
  currency: string,
  rates: Record<string, number> | null,
): number {
  // No static fallback rate: if the FX table is unavailable the price shows
  // in USD (rate 1) rather than a potentially stale local figure.
  return rates?.[currency.toUpperCase()] ?? 1;
}
