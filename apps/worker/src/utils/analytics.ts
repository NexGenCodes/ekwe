import type { Env } from "@/core/types";
import { hashKey } from "@/utils/keys";

/**
 * Workers Analytics Engine positional layout for dataset `ekwe_provider`.
 * Columns are positional and frozen — only append to reserved slots.
 */
export const AE_LAYOUT = {
  BLOB_EVENT_TYPE: 1,
  BLOB_OUTCOME: 2,
  BLOB_PROVIDER: 3,
  BLOB_TIER: 4,
  BLOB_ERROR_CLASS: 5,
  BLOB_USER: 6,
  BLOB_USAGE_TYPE: 7,
  BLOB_SOURCE: 8,
  BLOB_REASON: 9,
  BLOB_HTTP_STATUS: 10,
} as const;

const SCHEMA_VERSION = "v1";

export interface AnalyticsEvent {
  index: string;
  eventType: string;
  outcome: string;
  provider?: string;
  tier?: string;
  errorClass?: string;
  userHash?: string;
  usageType?: string;
  source?: string;
  reason?: string;
  httpStatus?: string;
  latencyMs?: number;
  attempt?: number;
}

/** Best-effort Analytics Engine emitter. No-ops when the EKWE_ANALYTICS binding is absent. */
export function recordEvent(env: Env, event: AnalyticsEvent): void {
  const dataset = env.EKWE_ANALYTICS;
  if (!dataset || typeof dataset.writeDataPoint !== "function") return;
  try {
    dataset.writeDataPoint({
      indexes: [event.index],
      blobs: [
        SCHEMA_VERSION,
        event.eventType,
        event.outcome,
        event.provider ?? "",
        event.tier ?? "",
        event.errorClass ?? "",
        event.userHash ?? "",
        event.usageType ?? "",
        event.source ?? "",
        event.reason ?? "",
        event.httpStatus ?? "",
      ],
      doubles: [event.latencyMs ?? 0, event.attempt ?? 0],
    });
  } catch {
    // Telemetry must never break the request path.
  }
}

/** Emits per-attempt provider telemetry, indexed by `route:provider`. */
export function recordProviderAttempt(
  env: Env,
  route: string,
  provider: string,
  outcome: "success" | "failure" | "skip" | "rejected",
  latencyMs: number,
  errorClass = "",
  attempt = 0,
  tier?: string,
): void {
  recordEvent(env, {
    index: `${route}:${provider}`,
    eventType: "provider_attempt",
    outcome,
    provider,
    tier,
    errorClass,
    latencyMs,
    attempt,
  });
}

/**
 * Speech-cache hit/miss/write telemetry. No user identifiers involved.
 */
export function recordSpeechCacheEvent(
  env: Env,
  outcome: "hit" | "miss" | "write",
  source: "kv" | "r2" | "none",
): void {
  recordEvent(env, {
    index: "speech_cache:speech_cache",
    eventType: "speech_cache",
    outcome,
    source,
  });
}

async function hashUserId(userId: string): Promise<string> {
  try {
    return await hashKey(userId);
  } catch {
    return "hash-failed";
  }
}

/** User-scoped event. Stores only a SHA-256 hash of the userId. */
export async function recordUserEvent(
  env: Env,
  route: string,
  userId: string,
  outcome: string,
  usageType?: string,
  reason?: string,
): Promise<void> {
  const userHash = await hashUserId(userId);
  recordEvent(env, {
    index: `${route}:${route}`,
    eventType: "user",
    outcome,
    userHash,
    usageType,
    reason,
  });
}

/** Per-request telemetry for matched routes. 4xx responses are "success"; >= 500 are "error". */
export function recordRequestEvent(
  env: Env,
  route: string,
  status: number,
  latencyMs: number,
  tier?: string,
): void {
  recordEvent(env, {
    index: `${route}:${route}`,
    eventType: "request",
    outcome: status >= 500 ? "error" : "success",
    tier,
    httpStatus: String(status),
    latencyMs,
  });
}
