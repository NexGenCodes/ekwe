import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/services/supabase";
import { fetchWithRetry } from "@/utils/networkUtils";

export interface ServerPriceDetail {
  amount: number;
  currency: string;
  lowestUnit: number;
}

export interface ServerPricing {
  monthly: ServerPriceDetail;
  annual: ServerPriceDetail;
}

export interface PricingResponse {
  pricing: Record<string, ServerPricing>;
}

async function fetchPricing(): Promise<PricingResponse> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
  if (!workerUrl) {
    throw new Error("Worker URL not configured");
  }

  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetchWithRetry(`${workerUrl}/checkout/pricing`, {
    headers,
    retries: 2,
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  return response.json() as Promise<PricingResponse>;
}

export function usePricingQuery(): UseQueryResult<PricingResponse> {
  return useQuery({
    queryKey: ["pricing"],
    queryFn: fetchPricing,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });
}
