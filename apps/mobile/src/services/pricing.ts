import { storePricingResponseSchema } from "@ekwe/shared";
import type { StorePricingResponse } from "@ekwe/shared";

import { getWorkerUrl } from "@/utils/http";

export async function fetchWorkerPricing(
  currency?: string,
): Promise<StorePricingResponse> {
  const base = getWorkerUrl();
  if (!base) {
    throw new Error("Worker URL not configured");
  }

  const url = new URL(`${base}/pricing`);
  if (currency) url.searchParams.set("currency", currency.toUpperCase());

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Pricing request failed with status ${res.status}`);
  }
  const data: unknown = await res.json();
  const parsed = storePricingResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Pricing response failed schema validation");
  }
  return parsed.data;
}
