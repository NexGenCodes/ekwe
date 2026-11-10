import type { Env } from "@/core/types";
import { logger } from "@/core/logger";

export type BillingEventStatus =
  | "succeeded"
  | "pending"
  | "failed"
  | "refunded"
  | "cancelled"
  | "expired"
  | "rejected"
  | "ignored"
  | "unknown";

export interface BillingEventInput {
  provider?: string;
  eventKey: string;
  eventType: string;
  status: BillingEventStatus;
  userId?: string | null;
  txRef?: string | null;
  flwRef?: string | null;
  externalId?: string | number | null;
  amount?: number | null;
  currency?: string | null;
  plan?: string | null;
  platform?: string | null;
  message?: string | null;
  detail?: Record<string, unknown> | null;
  occurredAt?: number | null;
}

function trimOrNull(
  value: string | null | undefined,
  max = 500,
): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function recordBillingEvent(
  env: Env,
  input: BillingEventInput,
): Promise<void> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const provider = trimOrNull(input.provider, 32) ?? "flutterwave";
  const eventKey = trimOrNull(input.eventKey, 300);
  if (!eventKey) return;
  const detail =
    input.detail && Object.keys(input.detail).length > 0
      ? JSON.stringify(input.detail).slice(0, 2000)
      : null;
  try {
    await env.DB.prepare(
      `INSERT INTO billing_events (
         id, provider, event_key, event_type, status, user_id, tx_ref, flw_ref,
         external_id, amount, currency, plan, platform, message, detail, occurred_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET
         status = excluded.status,
         user_id = COALESCE(excluded.user_id, billing_events.user_id),
         tx_ref = COALESCE(excluded.tx_ref, billing_events.tx_ref),
         flw_ref = COALESCE(excluded.flw_ref, billing_events.flw_ref),
         external_id = COALESCE(excluded.external_id, billing_events.external_id),
         amount = COALESCE(excluded.amount, billing_events.amount),
         currency = COALESCE(excluded.currency, billing_events.currency),
         plan = COALESCE(excluded.plan, billing_events.plan),
         platform = COALESCE(excluded.platform, billing_events.platform),
         message = COALESCE(excluded.message, billing_events.message),
         detail = CASE WHEN excluded.detail IS NOT NULL THEN excluded.detail ELSE billing_events.detail END,
         occurred_at = COALESCE(excluded.occurred_at, billing_events.occurred_at)`,
    )
      .bind(
        id,
        provider,
        eventKey,
        trimOrNull(input.eventType, 80) ?? "unknown",
        input.status,
        trimOrNull(input.userId, 120),
        trimOrNull(input.txRef, 200),
        trimOrNull(input.flwRef, 200),
        input.externalId == null
          ? null
          : String(input.externalId).slice(0, 120),
        typeof input.amount === "number" && Number.isFinite(input.amount)
          ? input.amount
          : null,
        trimOrNull(input.currency, 10)?.toUpperCase() ?? null,
        trimOrNull(input.plan, 40),
        trimOrNull(input.platform, 20),
        trimOrNull(input.message, 300),
        detail,
        typeof input.occurredAt === "number" ? input.occurredAt : null,
        now,
      )
      .run();
  } catch (e) {
    logger.warn("[billing-events] failed to record event", {
      eventKey,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function parseEventOccurredAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
