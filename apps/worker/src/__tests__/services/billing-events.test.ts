import { afterEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "@/__tests__/helpers/sqlite-d1";
import {
  parseEventOccurredAt,
  recordBillingEvent,
} from "@/services/billing-events";
import type { Env } from "@/core/types";

describe("billing-events", () => {
  let close: (() => void) | null = null;

  afterEach(() => {
    close?.();
    close = null;
  });

  test("parseEventOccurredAt parses valid ISO strings", () => {
    expect(parseEventOccurredAt("2026-01-02T03:04:05.000Z")).toBe(
      Date.parse("2026-01-02T03:04:05.000Z"),
    );
    expect(parseEventOccurredAt("nope")).toBeNull();
    expect(parseEventOccurredAt(null)).toBeNull();
  });

  test("records and merges billing events by key", async () => {
    const db = createTestDatabase();
    close = () => db.sqlite.close();
    const env = { DB: db.d1 } as unknown as Env;

    await recordBillingEvent(env, {
      eventKey: "k1",
      eventType: "charge.success",
      status: "pending",
      txRef: "tx1",
      amount: 10,
      currency: "ngn",
      message: "first",
      detail: { a: 1 },
      occurredAt: 100,
      externalId: 77,
    });
    await recordBillingEvent(env, {
      eventKey: "k1",
      eventType: "charge.success",
      status: "succeeded",
      userId: "u1",
      flwRef: "flw1",
      plan: "monthly",
      platform: "web",
      message: "second",
      detail: { b: 2 },
      occurredAt: 200,
    });

    const row = await db.d1
      .prepare("SELECT * FROM billing_events WHERE event_key = ?")
      .bind("k1")
      .first<Record<string, unknown>>();

    expect(row?.status).toBe("succeeded");
    expect(row?.user_id).toBe("u1");
    expect(row?.tx_ref).toBe("tx1");
    expect(row?.flw_ref).toBe("flw1");
    expect(row?.external_id).toBe("77");
    expect(row?.amount).toBe(10);
    expect(row?.currency).toBe("NGN");
    expect(row?.plan).toBe("monthly");
    expect(row?.platform).toBe("web");
    expect(row?.message).toBe("second");
    expect(JSON.parse(String(row?.detail))).toEqual({ b: 2 });
    expect(row?.occurred_at).toBe(200);
  });

  test("ignores empty keys and swallows db errors", async () => {
    const db = createTestDatabase();
    close = () => db.sqlite.close();
    const env = { DB: db.d1 } as unknown as Env;

    await recordBillingEvent(env, {
      eventKey: "   ",
      eventType: "x",
      status: "unknown",
    });
    const count = await db.d1
      .prepare("SELECT COUNT(*) as n FROM billing_events")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);

    const bad = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => {
              throw new Error("boom");
            },
          }),
        }),
      },
    } as unknown as Env;

    await expect(
      recordBillingEvent(bad, {
        eventKey: "k2",
        eventType: "x",
        status: "failed",
      }),
    ).resolves.toBeUndefined();
  });
});
