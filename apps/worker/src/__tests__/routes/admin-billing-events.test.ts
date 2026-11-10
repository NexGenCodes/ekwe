import { describe, expect, test } from "vitest";
import { createTestDatabase } from "@/__tests__/helpers/sqlite-d1";
import { handleBilling } from "@/routes/adminOps";

function makeContext(db: D1Database, query: Record<string, string> = {}) {
  return {
    env: { DB: db },
    req: {
      query: (key: string) => query[key],
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Parameters<typeof handleBilling>[0];
}

describe("admin billing events", () => {
  test("returns summary and payment events", async () => {
    const db = createTestDatabase();
    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO users (id, email, email_norm, created_at, updated_at)
         VALUES ('u1', 'u1@example.com', 'u1@example.com', ?, ?)`,
      )
      .run(now, now);
    await db.d1
      .prepare(
        `INSERT INTO billing_events (
          id, provider, event_key, event_type, status, user_id, tx_ref, flw_ref,
          external_id, amount, currency, plan, platform, message, detail, occurred_at, created_at
        ) VALUES (?, 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, ?)`,
      )
      .bind(
        "e1",
        "k1",
        "charge.success",
        "succeeded",
        "u1",
        "tx1",
        "flw1",
        "101",
        3000,
        "NGN",
        "monthly",
        "Paid",
        JSON.stringify({ source: "verify" }),
        now - 1000,
        now,
      )
      .run();

    const res = await handleBilling(
      makeContext(db.d1, { section: "all", limit: "10" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      summary: { eventsTotal: number; eventsSucceeded: number };
      events: { total: number; items: Array<Record<string, unknown>> };
    };
    expect(data.summary.eventsTotal).toBe(1);
    expect(data.summary.eventsSucceeded).toBe(1);
    expect(data.events.total).toBe(1);
    expect(data.events.items[0].event_type).toBe("charge.success");
    expect(data.events.items[0].status).toBe("succeeded");
    expect(data.events.items[0].user_email).toBe("u1@example.com");

    const filtered = await handleBilling(
      makeContext(db.d1, { section: "events", status: "failed" }),
    );
    const fdata = (await filtered.json()) as {
      events: { total: number };
    };
    expect(fdata.events.total).toBe(0);

    db.sqlite.close();
  });
});
