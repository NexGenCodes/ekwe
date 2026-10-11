import { describe, test, expect, beforeEach, vi } from "vitest";

import { processWebhookEvent } from "@/services/billing";
import "@/services/flutterwave";
import { resetPricingCache } from "@/routes/pricing";
import {
  executeQueryChunks,
  jsonBody,
  mockDb,
  mockEnv,
} from "@/__tests__/setup";

const SEEDED_CONFIG = {
  id: 1,
  base_price_usd: 2.23,
  discount_percent: 0,
  annual_discount_percent: 20,
  local_prices: {
    USD: { monthly: 2.23, annual: 21.41 },
    NGN: { monthly: 3000, annual: 28800 },
    GHS: { monthly: 25, annual: 240 },
    KES: { monthly: 288, annual: 2765 },
    ZAR: { monthly: 36, annual: 346 },
    ZMW: { monthly: 41, annual: 394 },
    UGX: { monthly: 8200, annual: 78720 },
    TZS: { monthly: 5900, annual: 56640 },
    RWF: { monthly: 3260, annual: 31296 },
    XOF: { monthly: 1270, annual: 12192 },
    XAF: { monthly: 1270, annual: 12192 },
    GBP: { monthly: 1.65, annual: 15.84 },
    EUR: { monthly: 1.93, annual: 18.53 },
    CAD: { monthly: 3.09, annual: 29.66 },
  },
};

function serveSeededConfig() {
  // mockDb.where is used by billing config lookup
  mockDb.where.mockResolvedValue([
    {
      id: 1,
      basePriceUsd: 2.23,
      discountPercent: 0,
      annualDiscountPercent: 20,
      localPrices: SEEDED_CONFIG.local_prices,
    },
  ]);
}

function successRpc() {
  mockDb.execute.mockImplementation(async (_query) => {
    return [{ permanent: false }];
  });
}

function failRpc(status = 500) {
  mockDb.execute.mockImplementation(async (_query) => {
    if (status >= 400 && status < 500) {
      return [{ permanent: true }];
    }
    throw new Error("Internal error");
  });
}

function getSetProStatusCall() {
  const calls = mockDb.execute.mock.calls;
  const setProStatusCall = calls.find((c) =>
    JSON.stringify(c[0]).includes("set_pro_status"),
  );
  if (!setProStatusCall) return null;

  const chunks = executeQueryChunks(setProStatusCall[0]);
  return {
    email: chunks[1],
    userId: chunks[3],
    isPro: chunks[5],
    expiresAt: chunks[7],
    provider: chunks[9],
    paymentRef: chunks[11],
  };
}

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 12345,
    event: "charge.success",
    created_at: new Date().toISOString(),
    data: {
      id: 99999,
      tx_ref: "ekwe_user-123_monthly",
      flw_ref: "flw-ref-abc",
      status: "successful",
      amount: 2.23,
      currency: "USD",
      customer: {
        id: 1,
        name: "Test User",
        phone_number: null,
        email: "test@example.com",
      },
      meta: {
        user_id: "user-123",
        plan: "ekwe_pro_monthly",
        amount: 2.23,
        currency: "USD",
      },
      subscription: {
        id: 100,
        amount: 2.23,
        subscription_code: "SUB-ABC",
        email_token: "token-xyz",
        status: "active",
        next_payment_date: new Date(Date.now() + 30 * 86400000).toISOString(),
        end_date: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    },
    ...overrides,
  };
}

describe("Flutterwave Event Processor", () => {
  const env = mockEnv({ FLUTTERWAVE_WEBHOOK_SECRET: "fw-secret-123" });

  beforeEach(() => {
    vi.clearAllMocks();
    successRpc();

    resetPricingCache();
    serveSeededConfig();
  });

  describe("charge.success", () => {
    test("grants Pro for successful charge", async () => {
      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(true);
      expect(result.response.status).toBe(200);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("activated");

      const callArgs = getSetProStatusCall();
      expect(callArgs).toBeDefined();
      expect(callArgs?.email).toBe("test@example.com");
      expect(callArgs?.isPro).toBe(true);
    });

    test("sets expires_at from subscription.end_date", async () => {
      const endDate = new Date("2025-12-01T00:00:00Z");
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          subscription: {
            ...buildEvent().data.subscription,
            end_date: endDate.toISOString(),
          },
        },
      });

      await processWebhookEvent("flutterwave", event, env);

      const callArgs = getSetProStatusCall();
      expect(callArgs?.expiresAt).toBe(endDate.toISOString());
    });

    test("grants Pro for NGN charge at the NGN price", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 3000,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            amount: 3000,
            currency: "NGN",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("activated");
    });

    test("rejects a charge at the bundled-map price when Supabase prices it lower", async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 1,
          basePriceUsd: 2.23,
          discountPercent: 0,
          annualDiscountPercent: 20,
          localPrices: {
            ...SEEDED_CONFIG.local_prices,
            NGN: { monthly: 2500, annual: 24000 },
          },
        },
      ]);
      resetPricingCache();

      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 3000,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            amount: 3000,
            currency: "NGN",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("grants at the Supabase row price when it differs from the bundled map", async () => {
      mockDb.where.mockResolvedValue([
        {
          id: 1,
          basePriceUsd: 2.23,
          discountPercent: 0,
          annualDiscountPercent: 20,
          localPrices: {
            ...SEEDED_CONFIG.local_prices,
            NGN: { monthly: 2500, annual: 24000 },
          },
        },
      ]);
      resetPricingCache();

      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 2500,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            amount: 2500,
            currency: "NGN",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("activated");
    });

    test("retries without granting when Supabase cannot confirm the price", async () => {
      mockDb.where.mockRejectedValue(new Error("Internal Server Error"));
      resetPricingCache();

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(false);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("unverified");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects charge with amount mismatch (server-derived price)", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 5.0,
          meta: {
            ...buildEvent().data.meta,
            amount: 2.23,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects tampered payment where meta echoes the wrong amount", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 100,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            amount: 100,
            currency: "NGN",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects charge in a currency checkout never authorizes", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 2.23,
          currency: "EGP",
          meta: {
            ...buildEvent().data.meta,
            amount: 2.23,
            currency: "EGP",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects annual plan charged at the monthly price", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: "ekwe_user-123_annual",
          amount: 2.23,
          meta: {
            ...buildEvent().data.meta,
            plan: "ekwe_pro_annual",
            amount: 2.23,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("grants Pro for annual charge at the annual price", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: "ekwe_user-123_annual",
          amount: 21.41,
          meta: {
            ...buildEvent().data.meta,
            plan: "ekwe_pro_annual",
            amount: 21.41,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("activated");
    });

    test("rejects charge with currency mismatch (legacy meta fallback)", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: "flw-sub-ref-no-plan",
          amount: 2.23,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            plan: "",
            amount: 2.23,
            currency: "USD",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects underpayment where an unresolvable plan echoes its own meta amount", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: "flw-sub-ref-no-plan",
          amount: 100,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            plan: "",
            amount: 100,
            currency: "NGN",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("rejects a charge with no meta.amount at all (unconditional grant hole)", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: "flw-sub-ref-no-plan",
          amount: 0.01,
          currency: "USD",
          meta: {
            ...buildEvent().data.meta,
            plan: "",
            amount: undefined,
            currency: undefined,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("rejected");
      expect(getSetProStatusCall()).toBeNull();
    });

    test("skips event with missing data", async () => {
      const event = { id: 1, event: "charge.success", data: null };

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("skipped");
    });
  });

  describe("subscription.paused", () => {
    test("revokes Pro immediately", async () => {
      const event = buildEvent({ event: "subscription.paused" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("deactivated");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(false);
      expect(callArgs?.expiresAt).toBeNull();
    });
  });

  describe("subscription.completed", () => {
    test("retains Pro until end_date", async () => {
      const endDate = new Date("2025-12-01T00:00:00Z");
      const event = buildEvent({
        event: "subscription.completed",
        data: {
          ...buildEvent().data,
          subscription: {
            ...buildEvent().data.subscription,
            end_date: endDate.toISOString(),
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("retained");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(true);
      expect(callArgs?.expiresAt).toBe(endDate.toISOString());
    });
  });

  describe("subscription.cancelled", () => {
    test("retains Pro until expiry date", async () => {
      const endDate = new Date("2025-12-01T00:00:00Z");
      const event = buildEvent({
        event: "subscription.cancelled",
        data: {
          ...buildEvent().data,
          subscription: {
            ...buildEvent().data.subscription,
            end_date: endDate.toISOString(),
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("retained");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(true);
      expect(callArgs?.expiresAt).toBe(endDate.toISOString());
    });
  });

  describe("subscription.expired", () => {
    test("revokes Pro", async () => {
      const event = buildEvent({ event: "subscription.expired" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("deactivated");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(false);
      expect(callArgs?.expiresAt).toBeNull();
    });
  });

  describe("invoice.updated", () => {
    test("renews Pro with new end_date", async () => {
      const newEndDate = new Date("2026-01-01T00:00:00Z");
      const event = buildEvent({
        event: "invoice.updated",
        data: {
          ...buildEvent().data,
          subscription: {
            ...buildEvent().data.subscription,
            end_date: newEndDate.toISOString(),
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("renewed");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(true);
      expect(callArgs?.expiresAt).toBe(newEndDate.toISOString());
    });

    test("skips invoice without end_date", async () => {
      const event = buildEvent({
        event: "invoice.updated",
        data: {
          ...buildEvent().data,
          subscription: {
            ...buildEvent().data.subscription,
            end_date: null,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("skipped");
    });
  });

  describe("charge.refund / charge.refunded", () => {
    test("revokes Pro on a completed refund", async () => {
      const event = buildEvent({
        event: "charge.refund",
        data: {
          ...buildEvent().data,
          status: "completed",
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("deactivated");

      const callArgs = getSetProStatusCall();
      expect(callArgs?.isPro).toBe(false);
      expect(callArgs?.expiresAt).toBeNull();
    });

    test("revokes Pro on charge.refunded", async () => {
      const event = buildEvent({
        event: "charge.refunded",
        data: {
          ...buildEvent().data,
          status: "successful",
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("deactivated");
      expect(getSetProStatusCall()).toBeDefined();
    });

    test("ignores pending refunds (no auth change yet)", async () => {
      const event = buildEvent({
        event: "charge.refund",
        data: {
          ...buildEvent().data,
          status: "pending",
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("ignored");
      expect(getSetProStatusCall()).toBeNull();
    });
  });

  describe("ignored events", () => {
    const ignoredEvents = [
      "charge.failed",
      "charge.abandoned",
      "charge.pending",
      "charge.initiated",
      "invoice.payment_failed",
      "transfer.completed",
      "transfer.failed",
      "transfer.reversed",
    ];

    test.each(ignoredEvents)("ignores %s", async (eventType) => {
      const event = buildEvent({ event: eventType });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("ignored");
      expect(getSetProStatusCall()).toBeNull();
    });
  });

  describe("unknown events", () => {
    test("acks unknown event types", async () => {
      const event = buildEvent({ event: "some.unknown.event" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("unknown");
    });
  });

  describe("RPC failures", () => {
    test("returns not fullyApplied when Supabase returns 500", async () => {
      failRpc(500);
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });

    test("acks (does not retry) when Supabase returns 400 (permanent)", async () => {
      failRpc(400);
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
    });

    test("returns not fullyApplied on network error", async () => {
      mockDb.execute.mockRejectedValue(new Error("Network error"));
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });
  });

  describe("user resolution", () => {
    test("resolves user by email", async () => {
      const event = buildEvent();

      await processWebhookEvent("flutterwave", event, env);

      const callArgs = getSetProStatusCall();
      expect(callArgs?.email).toBe("test@example.com");
      expect(callArgs?.userId).toBeNull();
    });

    test("resolves user by tx_ref when email missing", async () => {
      const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          tx_ref: `ekwe_${userId}_monthly`,
          customer: { id: 1, name: "Test User", phone_number: null, email: "" },
        },
      });

      await processWebhookEvent("flutterwave", event, env);

      const callArgs = getSetProStatusCall();
      expect(callArgs?.email).toBeNull();
      expect(callArgs?.userId).toBe(userId);
    });

    test("skips when neither email nor tx_ref available", async () => {
      const event = buildEvent();
      event.data.customer.email = "";
      event.data.tx_ref = "invalid-ref";

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await jsonBody(result.response);
      expect(body.action).toBe("skipped");
      expect(getSetProStatusCall()).toBeNull();
    });
  });
});
