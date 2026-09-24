import type { Env } from "@/core/types";
import { hashKey } from "@/utils/keys";

/**
 * Workers Analytics Engine positional layout for dataset `ekwe_provider`.
 * Columns are positional and CANNOT be renamed or reordered after data exists —
 * treat this layout as frozen and only ever append to the reserved slots.
 *
 * index1: route[:provider] — the single sampling/filter key.
 *   e.g. "transcribe:groq", "preflight:preflight", "speech_cache:speech_cache"
 *
 * blob1:  schema_version   ("v1")
 * blob2:  event_type       (provider_attempt | speech_cache | user)
 * blob3:  outcome          (success|failure|skip | hit|miss|write | allow|deny|ok|fail|unconfigured)
 * blob4:  provider         ('' for non-provider events)
 * blob5:  tier             (FREE | PREMIUM, '' if none)
 * blob6:  error_class      ('' if none)
 * blob7:  user_hash        (SHA-256 of userId, '' if none)
 * blob8:  usage_type       ('' if none)
 * blob9:  source           (kv | r2 | none, '' if none)
 * blob10: reason           ('' if none)
 * blob11: http_status      ('' if none)
 * blob12-20: reserved
 *
 * double1: latency_ms
 * double2: attempt
 * double3-20: reserved
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

/**
 * Best-effort Analytics Engine emitter. No-ops (and never throws) when the
 * EKWE_ANALYTICS binding is absent, so tests and local dev without the binding
 * continue to work untouched. writeDataPoint is fire-and-forget.
 */
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

/**
 * Per-attempt provider telemetry, emitted from the failover choke point
 * (utils/retry.ts). The index is `route:provider` so each provider/route has
 * its own sampling bucket and can be filtered without a GROUP BY.
 */
export function recordProviderAttempt(
  env: Env,
  route: string,
  provider: string,
  outcome: "success" | "failure" | "skip",
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

/**
 * User-scoped event (preflight, usage, …). Only a SHA-256 hash of the userId is
 * stored in blob7 — raw identifiers never leave the worker.
 */
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

/**
 * Per-HTTP-request telemetry for matched routes, emitted from the pipeline
 * boundary (core/pipeline.ts). `outcome` is "error" only for server-side
 * failures (>= 500); 4xx responses are "success" (the worker handled them).
 * The HTTP status is stored in blob11 (http_status) for filtering.
 */
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
