/**
 * ─── Worker Pricing Service ──────────────────────────────────────
 *
 * Reads the worker's public GET /pricing endpoint (no auth required). The
 * worker prices from the single source of truth — the `subscription_config`
 * row's `local_prices` (per-currency monthly/annual amounts, NGN anchor), the
 * shared LOCAL_PRICES map as fallback — which is exactly the price
 * /billing/checkout will charge, so the billing screen can show the same
 * amount the Flutterwave flow will collect.
 */

import type { StorePricingResponse } from "@ekwe/shared";

import { getWorkerUrl } from "@/utils/networkUtils";

/**
 * Fetch local monthly/annual prices for a currency from the worker.
 * Throws on network/HTTP failure so callers can fall back to store pricing.
 */
export async function fetchWorkerPricing(
  currency: string,
): Promise<StorePricingResponse> {
  const base = getWorkerUrl();
  if (!base) {
    throw new Error("Worker URL not configured");
  }

  const url = new URL(`${base}/pricing`);
  url.searchParams.set("currency", currency.toUpperCase());

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Pricing request failed with status ${res.status}`);
  }
  return (await res.json()) as StorePricingResponse;
}
