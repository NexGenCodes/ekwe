import { describe, test, expect, beforeEach } from "vitest";
import { handleWebhook } from "../src/routes/webhook";
import type { Env } from "../src/types";
import { hexEncode } from "../src/utils/keys";
import { mockEnv, jsonResponse } from "./setup";
import { http } from "msw";
import { server } from "./msw/server";
import { PROVIDER_URLS } from "./msw/handlers";

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

async function hmac(
  body: string,
  secret: string,
  hash: "SHA-256" | "SHA-512",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return hexEncode(sig);
}

function requestWith(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://test/webhook", {
    method: "POST",
    headers,
    body,
  });
}

async function paystackRequest(body: string, env: Env): Promise<Request> {
  const sig = await hmac(body, env.PAYSTACK_SECRET_KEY, "SHA-512");
  return requestWith(body, { "x-paystack-signature": sig });
}

describe("handleWebhook", () => {
  let setProCalls: { body: string }[];

  beforeEach(() => {
    setProCalls = [];
    server.use(
      http.post(PROVIDER_URLS.supabaseSetProStatus, async ({ request }) => {
        setProCalls.push({
          body: await request.clone().text(),
        });
        return jsonResponse({ ok: true });
      }),
      // FX is deliberately unavailable: webhook amount validation falls back
      // to FALLBACK_RATES so the asserted lowest-unit amounts stay stable.
      http.get(PROVIDER_URLS.frankfurterLatest, () => jsonResponse({}, 500)),
    );
  });

  // ─── Guard rails ────────────────────────────────────────────────

  test("rejects oversized payloads via Content-Length header", async () => {
    const env = mockEnv();
    const req = new Request("http://test/webhook", {
      method: "POST",
      headers: { "Content-Length": "300000" },
    });
    const res = await handleWebhook(req, env, ctx);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });

  test("rejects oversized bodies", async () => {
    const env = mockEnv();
    const res = await handleWebhook(requestWith("x".repeat(300000)), env, ctx);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });

  test("rejects invalid signatures with 401", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({ event: "charge.success", data: {} });
    const res = await handleWebhook(
      requestWith(body, { "x-paystack-signature": "bad" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: "INVALID_SIGNATURE" }),
    );
  });

  test("rejects requests with no signature headers", async () => {
    const env = mockEnv();
    const res = await handleWebhook(
      requestWith(JSON.stringify({ event: "charge.success", data: {} })),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 for malformed JSON with a valid signature", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = "{invalid-json";
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_JSON" });
  });

  test("deduplicates identical webhook deliveries", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        amount: 300000,
        currency: "NGN",
        reference: "ekwe_user123_abc",
        customer: { email: "buyer@ekwe.app" },
        metadata: {
          user_id: "user-123",
          plan_id: "pro_monthly",
          currency: "NGN",
          amount: 300000,
        },
      },
    });
    const req1 = await paystackRequest(body, env);
    const req2 = await paystackRequest(body, env);

    const first = await handleWebhook(req1, env, ctx);
    expect(await first.json()).toEqual({ received: true, action: "activated" });

    const second = await handleWebhook(req2, env, ctx);
    expect(await second.json()).toEqual({
      received: true,
      action: "duplicate",
    });
  });

  // ─── Paystack ───────────────────────────────────────────────────

  test("paystack charge.success activates a validated user", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        amount: 300000,
        currency: "NGN",
        reference: "ekwe_user123_abc",
        customer: { email: "buyer@ekwe.app" },
        metadata: {
          user_id: "user-123",
          plan_id: "pro_monthly",
          currency: "NGN",
          amount: 300000,
        },
      },
    });
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "activated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("user-123");
    expect(setProCalls[0].body).toContain("p_is_pro");
  });

  test("paystack charge.success with mismatched amount is skipped", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        amount: 999999,
        currency: "NGN",
        reference: "ekwe_user123_abc",
        customer: {},
        metadata: {
          plan_id: "pro_monthly",
          currency: "NGN",
          amount: 300000,
        },
      },
    });
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("paystack charge.success with an invalid plan is skipped", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        amount: 300000,
        currency: "NGN",
        reference: "ekwe_user123_abc",
        customer: {},
        metadata: { plan_id: "premium" },
      },
    });
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("paystack subscription.disable deactivates by email", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({
      event: "subscription.disable",
      data: { customer: { email: "buyer@ekwe.app" } },
    });
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "deactivated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("buyer@ekwe.app");
    expect(setProCalls[0].body).toContain("p_is_pro");
  });

  test("paystack unhandled events are ignored", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "psk" });
    const body = JSON.stringify({ event: "invoice.create", data: {} });
    const req = await paystackRequest(body, env);
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "ignored" });
    expect(setProCalls).toHaveLength(0);
  });

  // ─── Flutterwave ────────────────────────────────────────────────

  test("flutterwave charge.completed activates a validated user", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const body = JSON.stringify({
      event: "charge.completed",
      data: {
        status: "successful",
        tx_ref: "ekwe_user456_ref",
        amount: 300000,
        currency: "NGN",
        customer: { email: "fw@ekwe.app" },
        meta: {
          user_id: "user-456",
          plan_id: "pro_monthly",
          currency: "NGN",
          amount: 300000,
        },
      },
    });
    const req = requestWith(body, { "verif-hash": "fw-hash" });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "activated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("user-456");
  });

  test("flutterwave charge.completed non-successful status is skipped", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const body = JSON.stringify({
      event: "charge.completed",
      data: { status: "failed", tx_ref: "ekwe_u_ref" },
    });
    const req = requestWith(body, { "verif-hash": "fw-hash" });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("flutterwave charge.completed without identity is skipped", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const body = JSON.stringify({
      event: "charge.completed",
      data: { status: "successful", tx_ref: "some-ref" },
    });
    const req = requestWith(body, { "verif-hash": "fw-hash" });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("flutterwave falls back to the reference user id", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const body = JSON.stringify({
      event: "charge.completed",
      data: {
        status: "successful",
        tx_ref: "ekwe_user789_ref",
        reference: "ekwe_user789_ref",
        amount: 300000,
        currency: "NGN",
        customer: {},
        meta: { plan_id: "pro_monthly", currency: "NGN", amount: 300000 },
      },
    });
    const req = requestWith(body, { "verif-hash": "fw-hash" });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "activated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("user789");
  });

  test("flutterwave unhandled events are ignored", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const body = JSON.stringify({ event: "charge.failed", data: {} });
    const req = requestWith(body, { "verif-hash": "fw-hash" });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "ignored" });
  });

  // ─── RevenueCat ─────────────────────────────────────────────────

  test("revenuecat activation events activate the app user", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "rc-user-1",
        product_id: "ekwe_pro_monthly",
      },
    });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "activated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("rc-user-1");
  });

  test("revenuecat activation events for a non-Pro product are skipped", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "rc-user-1",
        product_id: "com.other.app.coffee",
      },
    });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("revenuecat activation events matching the pro entitlement are accepted", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({
      event: {
        type: "RENEWAL",
        app_user_id: "rc-user-1",
        entitlement_ids: ["pro"],
      },
    });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "activated" });
    expect(setProCalls).toHaveLength(1);
  });

  test("revenuecat expiration events deactivate the app user", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({
      event: { type: "EXPIRATION", app_user_id: "rc-user-1" },
    });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "deactivated" });
    expect(setProCalls).toHaveLength(1);
    expect(setProCalls[0].body).toContain("rc-user-1");
  });

  test("revenuecat events without app_user_id are skipped", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({ event: { type: "INITIAL_PURCHASE" } });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "skipped" });
    expect(setProCalls).toHaveLength(0);
  });

  test("revenuecat unknown events are ignored", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const body = JSON.stringify({
      event: { type: "SOMETHING_ELSE", app_user_id: "rc-user-1" },
    });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const req = requestWith(body, { "x-revenuecat-signature": sig });
    const res = await handleWebhook(req, env, ctx);

    expect(await res.json()).toEqual({ received: true, action: "ignored" });
    expect(setProCalls).toHaveLength(0);
  });
});
