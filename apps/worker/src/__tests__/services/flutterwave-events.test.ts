import { describe, test, expect, beforeEach, vi, type Mock } from "vitest";

vi.mock("@/services/supabase", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/supabase")>();
  return { ...mod, supabasePost: vi.fn() };
});

import { processWebhookEvent } from "@/services/billing";
import "@/services/flutterwave";
import { resetPricingCache } from "@/routes/pricing";
import { mockEnv } from "@/__tests__/setup";
import { supabasePost } from "@/services/supabase";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

const mockedSupabasePost = supabasePost as Mock;

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
  server.use(
    http.get(PROVIDER_URLS.supabaseAppConfig, () =>
      Response.json([SEEDED_CONFIG]),
    ),
  );
}

function successRpc() {
  mockedSupabasePost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
}

function failRpc(status = 500) {
  mockedSupabasePost.mockResolvedValue({
    ok: false,
    status,
    text: async () => "Internal error",
  });
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("activated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_email: "test@example.com",
          p_is_pro: true,
        }),
      );
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

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_expires_at: endDate.toISOString(),
        }),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("activated");
    });

    test("rejects a charge at the bundled-map price when Supabase prices it lower", async () => {
      server.use(
        http.get(PROVIDER_URLS.supabaseAppConfig, () =>
          Response.json([
            {
              ...SEEDED_CONFIG,
              local_prices: {
                ...SEEDED_CONFIG.local_prices,
                NGN: { monthly: 2500, annual: 24000 },
              },
            },
          ]),
        ),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });

    test("grants at the Supabase row price when it differs from the bundled map", async () => {
      server.use(
        http.get(PROVIDER_URLS.supabaseAppConfig, () =>
          Response.json([
            {
              ...SEEDED_CONFIG,
              local_prices: {
                ...SEEDED_CONFIG.local_prices,
                NGN: { monthly: 2500, annual: 24000 },
              },
            },
          ]),
        ),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("activated");
    });

    test("retries without granting when Supabase cannot confirm the price", async () => {
      server.use(
        http.get(PROVIDER_URLS.supabaseAppConfig, () =>
          Response.json({ error: "Internal Server Error" }, { status: 500 }),
        ),
      );
      resetPricingCache();

      const result = await processWebhookEvent(
        "flutterwave",
        buildEvent(),
        env,
      );

      expect(result.fullyApplied).toBe(false);
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("unverified");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });

    test("skips event with missing data", async () => {
      const event = { id: 1, event: "charge.success", data: null };

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("skipped");
    });
  });

  describe("subscription.paused", () => {
    test("revokes Pro immediately", async () => {
      const event = buildEvent({ event: "subscription.paused" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("deactivated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: false,
          p_expires_at: null,
        }),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("retained");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: endDate.toISOString(),
        }),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("retained");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: endDate.toISOString(),
        }),
      );
    });
  });

  describe("subscription.expired", () => {
    test("revokes Pro", async () => {
      const event = buildEvent({ event: "subscription.expired" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("deactivated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: false,
          p_expires_at: null,
        }),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("renewed");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: newEndDate.toISOString(),
        }),
      );
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
      const body = (await result.response.json()) as any;
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("deactivated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: false,
          p_expires_at: null,
        }),
      );
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("deactivated");
      expect(mockedSupabasePost).toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("ignored");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
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
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("ignored");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });
  });

  describe("unknown events", () => {
    test("acks unknown event types", async () => {
      const event = buildEvent({ event: "some.unknown.event" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = (await result.response.json()) as any;
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
      mockedSupabasePost.mockRejectedValue(new Error("Network error"));
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });
  });

  describe("user resolution", () => {
    test("resolves user by email", async () => {
      const event = buildEvent();

      await processWebhookEvent("flutterwave", event, env);

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_email: "test@example.com",
          p_user_id: null,
        }),
      );
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

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_email: null,
          p_user_id: userId,
        }),
      );
    });

    test("skips when neither email nor tx_ref available", async () => {
      const event = buildEvent();
      event.data.customer.email = "";
      event.data.tx_ref = "invalid-ref";

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = (await result.response.json()) as any;
      expect(body.action).toBe("skipped");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });
  });
});
