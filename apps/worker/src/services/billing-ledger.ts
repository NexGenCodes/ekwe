import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import {
  recordBillingEvent,
  type BillingEventStatus,
} from "@/services/billing-events";

function now() {
  return Date.now();
}

function trim(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function json(v: unknown, max = 4000): string | null {
  if (v == null) return null;
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) : s;
  } catch {
    return null;
  }
}

function eventStatusFromPayment(status: string | null): BillingEventStatus {
  const s = (status ?? "").toLowerCase();
  if (s === "succeeded" || s === "successful" || s === "completed")
    return "succeeded";
  if (s === "pending" || s === "initiated") return "pending";
  if (s === "failed" || s === "abandoned" || s === "error") return "failed";
  if (s === "refunded") return "refunded";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "expired") return "expired";
  if (s === "disputed") return "failed";
  return "unknown";
}

export async function recordProviderSnapshot(
  env: Env,
  input: {
    recordType: string;
    providerId?: unknown;
    txRef?: unknown;
    flwRef?: unknown;
    userId?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    payload: unknown;
    occurredAt?: number | null;
  },
): Promise<void> {
  const ts = now();
  const payload = json(input.payload) ?? "{}";
  try {
    await env.DB.prepare(
      `INSERT INTO billing_provider_records (
        id, provider, record_type, provider_id, tx_ref, flw_ref, user_id, status,
        amount, currency, payload_json, occurred_at, created_at, updated_at
      ) VALUES (?, 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        trim(input.recordType, 40) ?? "unknown",
        trim(input.providerId, 120),
        trim(input.txRef, 200),
        trim(input.flwRef, 200),
        trim(input.userId, 120),
        trim(input.status, 40),
        num(input.amount),
        trim(input.currency, 10)?.toUpperCase() ?? null,
        payload,
        input.occurredAt ?? null,
        ts,
        ts,
      )
      .run();
  } catch (e) {
    logger.warn("[billing-ledger] snapshot failed", { error: String(e) });
  }
}

export async function upsertPaymentAttempt(
  env: Env,
  input: {
    userId?: unknown;
    txRef?: unknown;
    flwRef?: unknown;
    transactionId?: unknown;
    chargeId?: unknown;
    eventType?: unknown;
    status: string;
    amount?: unknown;
    currency?: unknown;
    plan?: unknown;
    paymentType?: unknown;
    processorResponse?: unknown;
    customerEmail?: unknown;
    narrative?: unknown;
    raw?: unknown;
    occurredAt?: number | null;
  },
): Promise<void> {
  const ts = now();
  const txRef = trim(input.txRef, 200);
  const transactionId = trim(input.transactionId, 120);
  const key = txRef || transactionId;
  if (!key) return;
  // no-op placeholder removed; identity resolved below

  try {
    const existing = txRef
      ? await env.DB.prepare(
          `SELECT id FROM billing_payment_attempts WHERE provider='flutterwave' AND tx_ref=? LIMIT 1`,
        )
          .bind(txRef)
          .first<{ id: string }>()
      : transactionId
        ? await env.DB.prepare(
            `SELECT id FROM billing_payment_attempts WHERE provider='flutterwave' AND transaction_id=? LIMIT 1`,
          )
            .bind(transactionId)
            .first<{ id: string }>()
        : null;
    const id = existing?.id ?? crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO billing_payment_attempts (
        id, provider, user_id, tx_ref, flw_ref, transaction_id, charge_id, event_type,
        status, amount, currency, plan, payment_type, processor_response, customer_email,
        narrative, raw_json, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?, 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, billing_payment_attempts.user_id),
        tx_ref = COALESCE(excluded.tx_ref, billing_payment_attempts.tx_ref),
        flw_ref = COALESCE(excluded.flw_ref, billing_payment_attempts.flw_ref),
        transaction_id = COALESCE(excluded.transaction_id, billing_payment_attempts.transaction_id),
        charge_id = COALESCE(excluded.charge_id, billing_payment_attempts.charge_id),
        event_type = COALESCE(excluded.event_type, billing_payment_attempts.event_type),
        status = excluded.status,
        amount = COALESCE(excluded.amount, billing_payment_attempts.amount),
        currency = COALESCE(excluded.currency, billing_payment_attempts.currency),
        plan = COALESCE(excluded.plan, billing_payment_attempts.plan),
        payment_type = COALESCE(excluded.payment_type, billing_payment_attempts.payment_type),
        processor_response = COALESCE(excluded.processor_response, billing_payment_attempts.processor_response),
        customer_email = COALESCE(excluded.customer_email, billing_payment_attempts.customer_email),
        narrative = COALESCE(excluded.narrative, billing_payment_attempts.narrative),
        raw_json = COALESCE(excluded.raw_json, billing_payment_attempts.raw_json),
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        trim(input.userId, 120),
        txRef,
        trim(input.flwRef, 200),
        transactionId,
        trim(input.chargeId, 120),
        trim(input.eventType, 80),
        input.status,
        num(input.amount),
        trim(input.currency, 10)?.toUpperCase() ?? null,
        trim(input.plan, 40),
        trim(input.paymentType, 40),
        trim(input.processorResponse, 300),
        trim(input.customerEmail, 200),
        trim(input.narrative, 300),
        json(input.raw),
        input.occurredAt ?? ts,
        ts,
        ts,
        ts,
      )
      .run();

    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: `attempt:${txRef ?? transactionId}:${input.status}`,
      eventType: trim(input.eventType, 80) ?? "payment.attempt",
      status: eventStatusFromPayment(input.status),
      userId: trim(input.userId, 120),
      txRef,
      flwRef: trim(input.flwRef, 200),
      externalId: transactionId,
      amount: num(input.amount),
      currency: trim(input.currency, 10),
      plan: trim(input.plan, 40),
      message: trim(input.processorResponse, 300) ?? `Payment ${input.status}`,
      detail: { ledger: "payment_attempt", status: input.status },
      occurredAt: input.occurredAt ?? ts,
    });
  } catch (e) {
    logger.warn("[billing-ledger] upsertPaymentAttempt failed", {
      error: String(e),
      txRef,
      transactionId,
    });
  }
}

export async function upsertRefund(
  env: Env,
  input: {
    providerRefundId?: unknown;
    transactionId?: unknown;
    txRef?: unknown;
    flwRef?: unknown;
    userId?: unknown;
    amountRefunded?: unknown;
    currency?: unknown;
    status?: unknown;
    reason?: unknown;
    raw?: unknown;
    occurredAt?: number | null;
  },
): Promise<void> {
  const ts = now();
  const providerRefundId = trim(input.providerRefundId, 120);
  const transactionId = trim(input.transactionId, 120);
  if (!providerRefundId && !transactionId) return;
  const statusRaw = (trim(input.status, 40) ?? "unknown").toLowerCase();
  const status =
    statusRaw.includes("completed") || statusRaw === "successful"
      ? "completed"
      : statusRaw.includes("pending")
        ? "pending"
        : statusRaw.includes("fail")
          ? "failed"
          : "unknown";
  try {
    const existing = providerRefundId
      ? await env.DB.prepare(
          `SELECT id FROM billing_refunds WHERE provider='flutterwave' AND provider_refund_id=? LIMIT 1`,
        )
          .bind(providerRefundId)
          .first<{ id: string }>()
      : await env.DB.prepare(
          `SELECT id FROM billing_refunds WHERE provider='flutterwave' AND transaction_id=? AND status=? LIMIT 1`,
        )
          .bind(transactionId, status)
          .first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO billing_refunds (
        id, provider, provider_refund_id, transaction_id, tx_ref, flw_ref, user_id,
        amount_refunded, currency, status, reason, raw_json, created_at_provider, created_at, updated_at
      ) VALUES (?, 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_refund_id = COALESCE(excluded.provider_refund_id, billing_refunds.provider_refund_id),
        transaction_id = COALESCE(excluded.transaction_id, billing_refunds.transaction_id),
        tx_ref = COALESCE(excluded.tx_ref, billing_refunds.tx_ref),
        flw_ref = COALESCE(excluded.flw_ref, billing_refunds.flw_ref),
        user_id = COALESCE(excluded.user_id, billing_refunds.user_id),
        amount_refunded = COALESCE(excluded.amount_refunded, billing_refunds.amount_refunded),
        currency = COALESCE(excluded.currency, billing_refunds.currency),
        status = excluded.status,
        reason = COALESCE(excluded.reason, billing_refunds.reason),
        raw_json = COALESCE(excluded.raw_json, billing_refunds.raw_json),
        created_at_provider = COALESCE(excluded.created_at_provider, billing_refunds.created_at_provider),
        updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        providerRefundId,
        transactionId,
        trim(input.txRef, 200),
        trim(input.flwRef, 200),
        trim(input.userId, 120),
        num(input.amountRefunded),
        trim(input.currency, 10)?.toUpperCase() ?? null,
        status,
        trim(input.reason, 300),
        json(input.raw),
        input.occurredAt ?? null,
        ts,
        ts,
      )
      .run();

    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: `refund:${providerRefundId ?? transactionId}:${status}`,
      eventType: "charge.refund",
      status:
        status === "completed"
          ? "refunded"
          : status === "pending"
            ? "pending"
            : "failed",
      userId: trim(input.userId, 120),
      txRef: trim(input.txRef, 200),
      flwRef: trim(input.flwRef, 200),
      externalId: providerRefundId ?? transactionId,
      amount: num(input.amountRefunded),
      currency: trim(input.currency, 10),
      message: trim(input.reason, 300) ?? `Refund ${status}`,
      detail: { ledger: "refund", status },
      occurredAt: input.occurredAt ?? ts,
    });
  } catch (e) {
    logger.warn("[billing-ledger] upsertRefund failed", {
      error: String(e),
      providerRefundId,
      transactionId,
    });
  }
}

export async function upsertDispute(
  env: Env,
  input: {
    providerDisputeId: unknown;
    transactionId?: unknown;
    txRef?: unknown;
    flwRef?: unknown;
    userId?: unknown;
    amount?: unknown;
    currency?: unknown;
    status?: unknown;
    stage?: unknown;
    reason?: unknown;
    evidenceDueAt?: number | null;
    raw?: unknown;
    occurredAt?: number | null;
  },
): Promise<void> {
  const ts = now();
  const providerDisputeId = trim(input.providerDisputeId, 120);
  if (!providerDisputeId) return;
  const statusRaw = (trim(input.status, 40) ?? "unknown").toLowerCase();
  const status = statusRaw.includes("won")
    ? "won"
    : statusRaw.includes("lost")
      ? "lost"
      : statusRaw.includes("resolved") || statusRaw.includes("closed")
        ? "resolved"
        : statusRaw.includes("open") || statusRaw.includes("new")
          ? "open"
          : statusRaw.includes("pending")
            ? "pending"
            : "unknown";
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM billing_disputes WHERE provider='flutterwave' AND provider_dispute_id=? LIMIT 1`,
    )
      .bind(providerDisputeId)
      .first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO billing_disputes (
        id, provider, provider_dispute_id, transaction_id, tx_ref, flw_ref, user_id,
        amount, currency, status, stage, reason, evidence_due_at, raw_json,
        created_at_provider, created_at, updated_at
      ) VALUES (?, 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        transaction_id = COALESCE(excluded.transaction_id, billing_disputes.transaction_id),
        tx_ref = COALESCE(excluded.tx_ref, billing_disputes.tx_ref),
        flw_ref = COALESCE(excluded.flw_ref, billing_disputes.flw_ref),
        user_id = COALESCE(excluded.user_id, billing_disputes.user_id),
        amount = COALESCE(excluded.amount, billing_disputes.amount),
        currency = COALESCE(excluded.currency, billing_disputes.currency),
        status = excluded.status,
        stage = COALESCE(excluded.stage, billing_disputes.stage),
        reason = COALESCE(excluded.reason, billing_disputes.reason),
        evidence_due_at = COALESCE(excluded.evidence_due_at, billing_disputes.evidence_due_at),
        raw_json = COALESCE(excluded.raw_json, billing_disputes.raw_json),
        created_at_provider = COALESCE(excluded.created_at_provider, billing_disputes.created_at_provider),
        updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        providerDisputeId,
        trim(input.transactionId, 120),
        trim(input.txRef, 200),
        trim(input.flwRef, 200),
        trim(input.userId, 120),
        num(input.amount),
        trim(input.currency, 10)?.toUpperCase() ?? null,
        status,
        trim(input.stage, 80),
        trim(input.reason, 300),
        input.evidenceDueAt ?? null,
        json(input.raw),
        input.occurredAt ?? null,
        ts,
        ts,
      )
      .run();

    const evStatus: BillingEventStatus =
      status === "won" || status === "resolved"
        ? "succeeded"
        : status === "lost"
          ? "failed"
          : "pending";
    await recordBillingEvent(env, {
      provider: "flutterwave",
      eventKey: `dispute:${providerDisputeId}:${status}`,
      eventType: "charge.dispute",
      status: evStatus,
      userId: trim(input.userId, 120),
      txRef: trim(input.txRef, 200),
      flwRef: trim(input.flwRef, 200),
      externalId: providerDisputeId,
      amount: num(input.amount),
      currency: trim(input.currency, 10),
      message: trim(input.reason, 300) ?? `Dispute ${status}`,
      detail: { ledger: "dispute", status, stage: trim(input.stage, 80) },
      occurredAt: input.occurredAt ?? ts,
    });
  } catch (e) {
    logger.warn("[billing-ledger] upsertDispute failed", {
      error: String(e),
      providerDisputeId,
    });
  }
}
