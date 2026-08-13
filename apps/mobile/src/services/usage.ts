import { z } from "zod";

import { supabase } from "@/services/supabase";
import { fetchWithRetry } from "@/utils/networkUtils";
import logger from "@/utils/logger";

const usageSchema = z.object({
  day: z.string(),
  resetsAt: z.number(),
  translate: z.object({
    used: z.number(),
    total: z.number(),
    remaining: z.number(),
  }),
  transcribe: z.object({
    used: z.number(),
    total: z.number(),
    remaining: z.number(),
  }),
});

export type UsageSnapshot = z.infer<typeof usageSchema>;

export interface UsagePool {
  used: number;
  total: number;
  remaining: number;
}

/**
 * Fetches the caller's daily usage snapshot from the worker's read-only
 * /usage endpoint. Returns an error Result rather than throwing so callers
 * can decide how to degrade (hide the meter, show a retry state, etc.).
 */
export async function fetchUsage(): Promise<
  { ok: true; value: UsageSnapshot } | { ok: false; error: string }
> {
  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
  if (!workerUrl) {
    return { ok: false, error: "Worker URL not configured" };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  try {
    const response = await fetchWithRetry(`${workerUrl}/usage`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      retries: 1,
      timeout: 10000,
    });

    if (!response.ok) {
      return { ok: false, error: `Server returned ${response.status}` };
    }

    const json = (await response.json()) as unknown;
    const parsed = usageSchema.safeParse(json);
    if (!parsed.success) {
      logger.error("[fetchUsage] Response validation failed:", parsed.error.message);
      return { ok: false, error: "Invalid usage payload" };
    }

    return { ok: true, value: parsed.data };
  } catch (err) {
    logger.error(
      "[fetchUsage] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "Network error" };
  }
}