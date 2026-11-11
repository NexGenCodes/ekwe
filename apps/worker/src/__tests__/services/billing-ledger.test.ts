import { afterEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "@/__tests__/helpers/sqlite-d1";
import type { Env } from "@/core/types";
import {
  recordProviderSnapshot,
  upsertDispute,
  upsertPaymentAttempt,
  upsertRefund,
} from "@/services/billing-ledger";

describe("billing-ledger", () => {
  let close: (() => void) | null = null;
  afterEach(() => {
    close?.();
    close = null;
  });

  function setup() {
    const db = createTestDatabase();
    close = () => db.sqlite.close();
    const env = { DB: db.d1 } as unknown as Env;
    return { db, env };
  }

  test("records snapshots and payment attempts", async () => {
    const { db, env } = setup();
    await recordProviderSnapshot(env, {
      recordType: "webhook",
      providerId: "tx1",
      txRef: "ref1",
      flwRef: "flw1",
      userId: "u1",
      status: "successful",
      amount: 10,
      currency: "ngn",
      payload: { a: 1 },
      occurredAt: 100,
    });
    await upsertPaymentAttempt(env, {
      userId: "u1",
      txRef: "ref1",
      flwRef: "flw1",
      transactionId: "tx1",
      eventType: "charge.success",
      status: "successful",
      amount: 10,
      currency: "NGN",
      plan: "monthly",
      paymentType: "card",
      processorResponse: "Approved",
      customerEmail: "u@example.com",
      narrative: "pay",
      raw: { x: 1 },
      occurredAt: 100,
    });
    await upsertPaymentAttempt(env, {
      userId: "u1",
      txRef: "ref1",
      transactionId: "tx1",
      eventType: "charge.success",
      status: "succeeded",
      amount: 10,
      currency: "NGN",
    });

    const snap = await db.d1
      .prepare("SELECT COUNT(*) AS n FROM billing_provider_records")
      .first<{ n: number }>();
    const attempt = await db.d1
      .prepare("SELECT * FROM billing_payment_attempts WHERE tx_ref = ?")
      .bind("ref1")
      .first<Record<string, unknown>>();
    expect(snap?.n).toBe(1);
    expect(attempt?.status).toBe("succeeded");
    expect(attempt?.payment_type).toBe("card");
  });

  test("upserts refunds and disputes", async () => {
    const { db, env } = setup();
    await upsertRefund(env, {
      providerRefundId: "r1",
      transactionId: "tx1",
      txRef: "ref1",
      userId: "u1",
      amountRefunded: 5,
      currency: "NGN",
      status: "completed",
      reason: "test",
      raw: { r: 1 },
      occurredAt: 100,
    });
    await upsertRefund(env, {
      providerRefundId: "r1",
      transactionId: "tx1",
      status: "failed",
    });
    await upsertDispute(env, {
      providerDisputeId: "d1",
      transactionId: "tx1",
      txRef: "ref1",
      userId: "u1",
      amount: 5,
      currency: "NGN",
      status: "open",
      stage: "needs_response",
      reason: "fraud",
      raw: { d: 1 },
      occurredAt: 100,
    });
    await upsertDispute(env, {
      providerDisputeId: "d1",
      status: "won",
    });

    const refund = await db.d1
      .prepare("SELECT * FROM billing_refunds WHERE provider_refund_id = ?")
      .bind("r1")
      .first<Record<string, unknown>>();
    const dispute = await db.d1
      .prepare("SELECT * FROM billing_disputes WHERE provider_dispute_id = ?")
      .bind("d1")
      .first<Record<string, unknown>>();
    expect(refund?.status).toBe("failed");
    expect(dispute?.status).toBe("won");
  });

  test("ignores missing identity and handles db failures", async () => {
    const { env } = setup();
    await expect(
      upsertPaymentAttempt(env, { status: "pending" }),
    ).resolves.toBeUndefined();
    await expect(
      upsertRefund(env, { status: "pending" }),
    ).resolves.toBeUndefined();
    await expect(
      upsertDispute(env, { providerDisputeId: null, status: "open" }),
    ).resolves.toBeUndefined();

    const bad = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error("boom");
            },
            run: async () => {
              throw new Error("boom");
            },
          }),
        }),
      },
    } as unknown as Env;
    await expect(
      recordProviderSnapshot(bad, { recordType: "x", payload: {} }),
    ).resolves.toBeUndefined();
    await expect(
      upsertPaymentAttempt(bad, { txRef: "r", status: "failed" }),
    ).resolves.toBeUndefined();
  });
});
