import { describe, expect, test } from "vitest";
import { createTestDatabase } from "@/__tests__/helpers/sqlite-d1";
import { handleBilling, handleBillingSync } from "@/routes/adminOps";

function makeContext(
  db: D1Database,
  query: Record<string, string> = {},
  body: unknown = {},
) {
  return {
    env: { DB: db, APP_ENV: "test" },
    req: {
      query: (key: string) => query[key],
      json: async () => body,
    },
    get: (key: string) => (key === "adminEmail" ? "admin@test" : undefined),
    json: (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Parameters<typeof handleBilling>[0];
}

describe("admin billing ledger", () => {
  test("lists attempts, refunds, and disputes", async () => {
    const db = createTestDatabase();
    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO users (id, email, email_norm, created_at, updated_at)
         VALUES ('u1','u1@example.com','u1@example.com',?,?)`,
      )
      .run(now, now);
    await db.d1
      .prepare(
        `INSERT INTO billing_payment_attempts (id,provider,user_id,tx_ref,status,amount,currency,first_seen_at,last_seen_at,created_at,updated_at)
         VALUES ('a1','flutterwave','u1','tx1','succeeded',10,'NGN',?,?,?,?)`,
      )
      .bind(now, now, now, now)
      .run();
    await db.d1
      .prepare(
        `INSERT INTO billing_refunds (id,provider,provider_refund_id,transaction_id,tx_ref,user_id,amount_refunded,currency,status,created_at,updated_at)
         VALUES ('r1','flutterwave','rf1','t1','tx1','u1',5,'NGN','completed',?,?)`,
      )
      .bind(now, now)
      .run();
    await db.d1
      .prepare(
        `INSERT INTO billing_disputes (id,provider,provider_dispute_id,transaction_id,tx_ref,user_id,amount,currency,status,created_at,updated_at)
         VALUES ('d1','flutterwave','dp1','t1','tx1','u1',5,'NGN','open',?,?)`,
      )
      .bind(now, now)
      .run();

    const res = await handleBilling(
      makeContext(db.d1, { section: "all", limit: "10" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      attempts: { total: number; items: Array<{ tx_ref: string }> };
      refunds: { total: number };
      disputes: { total: number };
    };
    expect(data.attempts.total).toBe(1);
    expect(data.refunds.total).toBe(1);
    expect(data.disputes.total).toBe(1);
    expect(data.attempts.items[0].tx_ref).toBe("tx1");
    db.sqlite.close();
  });

  test("sync endpoint runs without Flutterwave secret", async () => {
    const db = createTestDatabase();
    const res = await handleBillingSync(
      makeContext(db.d1, {}, { days: 1 }) as unknown as Parameters<
        typeof handleBillingSync
      >[0],
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; transactions: number };
    expect(data.ok).toBe(true);
    expect(data.transactions).toBe(0);
    db.sqlite.close();
  });
});
