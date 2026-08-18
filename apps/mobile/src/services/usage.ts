import { usageSnapshotSchema } from "@ekwe/shared";
import type { UsageSnapshot } from "@ekwe/shared";

import { supabase } from "@/services/supabase";
import {
  fetchWithRetry,
  getWorkerUrl,
  isTimeoutError,
} from "@/utils/networkUtils";
import logger from "@/utils/logger";

export type { UsageSnapshot };

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
  const workerUrl = getWorkerUrl();
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
      timeout: 15000,
    });

    if (!response.ok) {
      return { ok: false, error: `Server returned ${response.status}` };
    }

    const json = (await response.json()) as unknown;
    const parsed = usageSnapshotSchema.safeParse(json);
    if (!parsed.success) {
      logger.error(
        "[fetchUsage] Response validation failed:",
        parsed.error.message,
      );
      return { ok: false, error: "Invalid usage payload" };
    }

    return { ok: true, value: parsed.data };
  } catch (err) {
    if (isTimeoutError(err)) {
      logger.info("[fetchUsage] Timed out waiting for usage snapshot");
      return { ok: false, error: "Timed out" };
    }
    logger.error(
      "[fetchUsage] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "Network error" };
  }
}
