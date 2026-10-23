import { beforeEach, describe, expect, test } from "vitest";

import { processWebhookEvent } from "@/services/billing";
import "@/services/flutterwave";
import { resetPricingCache } from "@/routes/pricing";
import type { Env } from "@/core/types";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";
import { jsonBody } from "@/__tests__/setup";

const USER_ID = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const EMAIL = "test@example.com";
const DAY_MS = 86_400_000;
const TX_REF = `ekwe_${USER_ID}_monthly_9f8e7d6c`;

function makeEnv(
  database: TestDatabase,
  overrides: Record<string, unknown> = {},
): Env {
  return {
    DB: database.d1,
    APP_ENV: "test",
    FLUTTERWAVE_WEBHOOK_SECRET: "whsec_test",
    ...overrides,
  } as unknown as Env;
}

function seedUser(database: TestDatabase): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, EMAIL, EMAIL, now, now);
}

function seedConfig(
  database: TestDatabase,
  localPrices: Record<string, { monthly: number; annual: number }> = {
    NGN: { monthly: 3000, annual: 28800 },
    USD: { monthly: 2.23, annual: 21.41 },
  },
): void {
  database.sqlite
    .prepare(
      "UPDATE app_config SET local_prices = ?, updated_at = ? WHERE id = 1",
    )
    .run(JSON.stringify(localPrices), Date.now());
}

function seedSubscription(
  database: TestDatabase,
  status: string,
  expiresAt: number | null,
): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO user_subscriptions
         (user_id, status, platform, expires_at, created_at, updated_at)
       VALUES (?, ?, 'web', ?, ?, ?)`,
    )
    .run(USER_ID, status, expiresAt, now, now);
  database.sqlite
    .prepare(
      "UPDATE users SET tier = 'PREMIUM', pro_expires_at = ? WHERE id = ?",
    )
    .run(expiresAt, USER_ID);
}

function seedClaim(
  database: TestDatabase,
  expiresAt: number,
  flwRef = "FLW-REF-1",
): void {
  database.sqlite
    .prepare(
      `INSERT INTO flutterwave_claims
         (flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at)
       VALUES (?, ?, ?, 3000, 'NGN', ?, ?)`,
    )
    .run(flwRef, USER_ID, TX_REF, expiresAt, Date.now());
}

function user(database: TestDatabase) {
  return database.sqlite
    .prepare("SELECT tier, pro_expires_at FROM users WHERE id = ?")
    .get(USER_ID) as { tier: string; pro_expires_at: number | null };
}

function subscription(database: TestDatabase) {
  return database.sqlite
    .prepare(
      "SELECT status, expires_at FROM user_subscriptions WHERE user_id = ?",
    )
    .get(USER_ID) as { status: string; expires_at: number | null } | undefined;
}

interface EventOverrides {
  event?: string;
  id?: number;
  data?: Record<string, unknown>;
}

function buildEvent(overrides: EventOverrides = {}): Record<string, unknown> {
  const data = {
    id: 1001,
    tx_ref: TX_REF,
    flw_ref: "FLW-REF-1",
    status: "successful",
    amount: 3000,
    currency: "NGN",
    customer: {
      id: 7,
      name: "Test User",
      phone_number: null,
      email: EMAIL,
    },
    meta: {
      user_id: USER_ID,
      plan: "ekwe_pro_monthly",
      amount: 3000,
      currency: "NGN",
    },
    subscription: {
      id: 55,
      amount: 3000,
      subscription_code: "SUB-1",
      email_token: "tok",
      status: "active",
      next_payment_date: null,
      end_date: null,
    },
    ...overrides.data,
  };

  return {
    id: overrides.id ?? 1,
    event: overrides.event ?? "charge.success",
    created_at: new Date().toISOString(),
    data,
  };
}

describe("Flutterwave event processing", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    resetPricingCache();
    database = createTestDatabase();
    seedUser(database);
    seedConfig(database);
    env = makeEnv(database);
  });

  describe("charge.success", () => {
    test("activates Paid for thirty days from the charge", async () => {
      const before = Date.now();
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(true);
      expect(await jsonBody(result.response)).toMatchObject({
        action: "activated",
      });

      const updated = user(database);
      expect(updated.tier).toBe("PREMIUM");
      expect(updated.pro_expires_at).toBeGreaterThanOrEqual(
        before + 30 * DAY_MS,
      );
      expect(subscription(database)?.status).toBe("active");
    });

    test("extends the remaining active term instead of replacing it", async () => {
      const existing = Date.now() + 10 * DAY_MS;
      seedSubscription(database, "active", existing);

      await processWebhookEvent("flutterwave", buildEvent(), env);

      expect(user(database).pro_expires_at).toBeGreaterThanOrEqual(
        existing + 30 * DAY_MS,
      );
    });

    test("grants a year for an annual charge", async () => {
      const txRef = `ekwe_${USER_ID}_annual_abc123`;
      const before = Date.now();

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          data: {
            tx_ref: txRef,
            amount: 28800,
            meta: { plan: "ekwe_pro_annual", amount: 28800, currency: "NGN" },
          },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "activated",
      });
      expect(user(database).pro_expires_at).toBeGreaterThanOrEqual(
        before + 365 * DAY_MS,
      );
    });

    test("uses the configured price, not the bundled one", async () => {
      seedConfig(database, { NGN: { monthly: 3500, annual: 33600 } });

      const rejected = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );
      expect(await jsonBody(rejected.response)).toMatchObject({
        action: "rejected",
      });
      expect(user(database).tier).toBe("FREE");

      const accepted = await processWebhookEvent(
        "flutterwave",
        buildEvent({ data: { amount: 3500 } }),
        env,
      );
      expect(await jsonBody(accepted.response)).toMatchObject({
        action: "activated",
      });
    });

    test("retries when prices cannot be confirmed", async () => {
      seedConfig(database, {});

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(false);
      expect(await jsonBody(result.response)).toMatchObject({
        action: "unverified",
      });
      expect(user(database).tier).toBe("FREE");
    });

    test("rejects an underpayment", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ data: { amount: 1 } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "rejected",
      });
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS n FROM flutterwave_claims")
          .get(),
      ).toEqual({
        n: 0,
      });
    });

    test("rejects an annual plan charged at the monthly price", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          data: {
            tx_ref: `ekwe_${USER_ID}_annual_abc123`,
            amount: 3000,
          },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "rejected",
      });
    });

    test("rejects an unsupported currency", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ data: { currency: "XYZ" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "rejected",
      });
    });

    test("repairs a grant that failed after the claim", async () => {
      const expiry = Date.now() + 30 * DAY_MS;
      seedClaim(database, expiry);

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(true);
      expect(await jsonBody(result.response)).toMatchObject({
        action: "activated",
      });
      expect(user(database)).toEqual({
        tier: "PREMIUM",
        pro_expires_at: expiry,
      });
    });

    test("a replay never shortens a later term", async () => {
      const later = Date.now() + 60 * DAY_MS;
      seedClaim(database, Date.now() + 30 * DAY_MS);
      database.sqlite
        .prepare(
          "UPDATE users SET tier = 'PREMIUM', pro_expires_at = ? WHERE id = ?",
        )
        .run(later, USER_ID);

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(true);
      expect(user(database).pro_expires_at).toBe(later);
    });

    test("a replayed flw_ref never extends the term twice", async () => {
      const first = await processWebhookEvent("flutterwave", buildEvent(), env);
      expect(await jsonBody(first.response)).toMatchObject({
        action: "activated",
      });
      const granted = user(database).pro_expires_at;

      const replay = await processWebhookEvent(
        "flutterwave",
        buildEvent({ id: 2 }),
        env,
      );

      expect(replay.fullyApplied).toBe(true);
      expect(await jsonBody(replay.response)).toMatchObject({
        action: "activated",
      });
      expect(user(database).pro_expires_at).toBe(granted);
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS n FROM flutterwave_claims")
          .get(),
      ).toEqual({ n: 1 });
    });
  });

  describe("revocation events", () => {
    beforeEach(() => {
      seedSubscription(database, "active", Date.now() + 20 * DAY_MS);
    });

    test("charge.refund revokes Paid", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "charge.refund", data: { status: "successful" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "deactivated",
      });
      expect(user(database)).toEqual({ tier: "FREE", pro_expires_at: null });
      expect(subscription(database)?.status).toBe("inactive");
    });

    test("charge.refunded revokes Paid", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "charge.refunded", data: { status: "completed" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "deactivated",
      });
      expect(user(database).tier).toBe("FREE");
    });

    test("ignores a refund that has not completed", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "charge.refund", data: { status: "pending" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "ignored",
      });
      expect(user(database).tier).toBe("PREMIUM");
    });

    test("subscription.paused and subscription.expired deactivate", async () => {
      for (const event of ["subscription.paused", "subscription.expired"]) {
        const result = await processWebhookEvent(
          "flutterwave",
          buildEvent({ event }),
          env,
        );
        expect(await jsonBody(result.response)).toMatchObject({
          action: "deactivated",
        });
        expect(user(database).tier).toBe("FREE");
      }
    });
  });

  describe("retention events", () => {
    const endDate = "2026-12-01T00:00:00.000Z";

    test("subscription.completed keeps Paid until end_date", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          event: "subscription.completed",
          data: { subscription: { end_date: endDate } },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "retained",
      });
      expect(user(database)).toEqual({
        tier: "PREMIUM",
        pro_expires_at: Date.parse(endDate),
      });
    });

    test("subscription.cancelled keeps Paid until end_date", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          event: "subscription.cancelled",
          data: { subscription: { end_date: endDate } },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "retained",
      });
      expect(user(database).pro_expires_at).toBe(Date.parse(endDate));
    });

    test("a retention event without end_date never grants permanent Paid", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "subscription.cancelled" }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "skipped",
      });
      expect(user(database)).toEqual({ tier: "FREE", pro_expires_at: null });
    });

    test("a retention event whose end_date has passed revokes Paid", async () => {
      seedSubscription(database, "active", Date.now() + DAY_MS);

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          event: "subscription.completed",
          data: { subscription: { end_date: "2020-01-01T00:00:00.000Z" } },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "retained",
      });
      expect(user(database)).toEqual({ tier: "FREE", pro_expires_at: null });
    });

    test("invoice.updated renews to end_date", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          event: "invoice.updated",
          data: { subscription: { end_date: endDate } },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "renewed",
      });
      expect(user(database).pro_expires_at).toBe(Date.parse(endDate));
    });

    test("invoice.updated without end_date is skipped", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "invoice.updated" }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "skipped",
      });
      expect(user(database).tier).toBe("FREE");
    });
  });

  describe("event dispatch", () => {
    test("acks ignored events", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "charge.failed", data: { status: "failed" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "ignored",
      });
    });

    test("acks unknown events without touching auth", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ event: "payout.completed" }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "unknown",
      });
      expect(user(database).tier).toBe("FREE");
    });

    test("skips an event with no data", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        { id: 1, event: "charge.success", data: null },
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "skipped",
      });
    });
  });

  describe("user resolution", () => {
    test("resolves by email when the tx_ref is not ours", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({ data: { tx_ref: "legacy-flw-ref" } }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "activated",
      });
      expect(user(database).tier).toBe("PREMIUM");
    });

    test("resolves by tx_ref when the email is missing", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          data: { customer: { id: 7, name: "T", phone_number: null } },
        }),
        env,
      );

      expect(await jsonBody(result.response)).toMatchObject({
        action: "activated",
      });
    });

    test("skips when no user matches", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent({
          data: {
            tx_ref: "legacy-flw-ref",
            customer: {
              id: 7,
              name: "T",
              phone_number: null,
              email: "nobody@test.dev",
            },
          },
        }),
        env,
      );

      expect(result.fullyApplied).toBe(true);
      expect(await jsonBody(result.response)).toMatchObject({
        action: "skipped",
      });
    });

    test("asks Flutterwave to retry when the database is unreachable", async () => {
      const broken = makeEnv(database, {
        DB: {
          prepare: () => {
            throw new Error("database is locked");
          },
        },
      });

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        broken,
      );

      expect(result.fullyApplied).toBe(false);
      expect(await jsonBody(result.response)).toMatchObject({
        action: "unverified",
      });
    });
  });
});
