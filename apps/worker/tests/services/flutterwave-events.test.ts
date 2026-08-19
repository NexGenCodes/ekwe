import { describe, test, expect, beforeEach, vi, type Mock } from "vitest";

// Mock supabasePost before importing the module under test
vi.mock("../../src/services/supabase", () => ({
  supabasePost: vi.fn(),
}));

import { processWebhookEvent } from "../../src/services/billing";
import "../../src/routes/flutterwave"; // Side-effect: registers flutterwave provider
import { mockEnv } from "../setup";
import { supabasePost } from "../../src/services/supabase";

// ─── Helpers ───────────────────────────────────────────────────────

const mockedSupabasePost = supabasePost as Mock;

function successRpc() {
  mockedSupabasePost.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
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
      amount: 2.0,
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
        amount: 2.0,
        currency: "USD",
      },
      subscription: {
        id: 100,
        amount: 2.0,
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

// ─── Tests ─────────────────────────────────────────────────────────

describe("Flutterwave Event Processor", () => {
  const env = mockEnv({ FLUTTERWAVE_WEBHOOK_SECRET: "fw-secret-123" });

  beforeEach(() => {
    vi.clearAllMocks();
    successRpc();
  });

  // ── charge.success ──

  describe("charge.success", () => {
    test("grants Pro for successful charge", async () => {
      const result = await processWebhookEvent("flutterwave", buildEvent(), env);

      expect(result.fullyApplied).toBe(true);
      expect(result.response.status).toBe(200);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("activated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_email: "test@example.com",
          p_is_pro: true,
        }),
        expect.any(Number),
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
        expect.any(Number),
      );
    });

    test("rejects charge with amount mismatch", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          amount: 5.0, // Charged $5 but expected $2
          meta: {
            ...buildEvent().data.meta,
            amount: 2.0,
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("rejected");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });

    test("rejects charge with currency mismatch", async () => {
      const event = buildEvent({
        data: {
          ...buildEvent().data,
          currency: "NGN",
          meta: {
            ...buildEvent().data.meta,
            currency: "USD",
          },
        },
      });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("rejected");
    });

    test("skips event with missing data", async () => {
      const event = { id: 1, event: "charge.success", data: null };

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("skipped");
    });
  });

  // ── subscription events ──

  describe("subscription.paused", () => {
    test("revokes Pro immediately", async () => {
      const event = buildEvent({ event: "subscription.paused" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("deactivated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: false,
          p_expires_at: null,
        }),
        expect.any(Number),
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
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("retained");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: endDate.toISOString(),
        }),
        expect.any(Number),
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
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("retained");

      // Should keep is_pro=true so user has access through paid period
      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: endDate.toISOString(),
        }),
        expect.any(Number),
      );
    });
  });

  describe("subscription.expired", () => {
    test("revokes Pro", async () => {
      const event = buildEvent({ event: "subscription.expired" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("deactivated");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: false,
          p_expires_at: null,
        }),
        expect.any(Number),
      );
    });
  });

  // ── Invoice events ──

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
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("renewed");

      expect(mockedSupabasePost).toHaveBeenCalledWith(
        env,
        "/rest/v1/rpc/set_pro_status",
        expect.objectContaining({
          p_is_pro: true,
          p_expires_at: newEndDate.toISOString(),
        }),
        expect.any(Number),
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
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("skipped");
    });
  });

  // ── Ignored events ──

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
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("ignored");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });
  });

  // ── Unknown events ──

  describe("unknown events", () => {
    test("acks unknown event types", async () => {
      const event = buildEvent({ event: "some.unknown.event" });

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("unknown");
    });
  });

  // ── Error handling ──

  describe("RPC failures", () => {
    test("returns not fullyApplied when Supabase returns 500", async () => {
      failRpc(500);
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });

    test("returns not fullyApplied when Supabase returns 400 (permanent)", async () => {
      failRpc(400);
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });

    test("returns not fullyApplied on network error", async () => {
      mockedSupabasePost.mockRejectedValue(new Error("Network error"));
      const event = buildEvent();

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(false);
    });
  });

  // ── User resolution ──

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
        expect.any(Number),
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
        expect.any(Number),
      );
    });

    test("skips when neither email nor tx_ref available", async () => {
      const event = buildEvent();
      event.data.customer.email = "";
      event.data.tx_ref = "invalid-ref";

      const result = await processWebhookEvent("flutterwave", event, env);

      expect(result.fullyApplied).toBe(true);
      const body = await result.response.json() as Record<string, string>;
      expect(body.action).toBe("skipped");
      expect(mockedSupabasePost).not.toHaveBeenCalled();
    });
  });
});
