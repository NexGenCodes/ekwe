import { usageSnapshotSchema } from "@ekwe/shared";
import type { UsageSnapshot } from "@ekwe/shared";

import { apiJson, isApiError } from "@/services/backend";
import logger from "@/utils/logger";

export type { UsageSnapshot };

export async function fetchUsage(): Promise<
  { ok: true; value: UsageSnapshot } | { ok: false; error: string }
> {
  try {
    const raw = await apiJson("/usage", { retries: 1, timeoutMs: 15_000 });
    const parsed = usageSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        "[fetchUsage] Response validation failed:",
        parsed.error.message,
      );
      return { ok: false, error: "Invalid usage payload" };
    }

    return { ok: true, value: parsed.data };
  } catch (err) {
    if (isApiError(err)) {
      return { ok: false, error: `Server returned ${err.status}` };
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      logger.info("[fetchUsage] Timed out waiting for usage snapshot");
      return { ok: false, error: "Timed out" };
    }
    logger.warn(
      "[fetchUsage] Failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, error: "Network error" };
  }
}
