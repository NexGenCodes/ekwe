import { describe, it, expect, vi, beforeEach } from "vitest";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { handleWebhook } from "../../src/routes/webhook";
import { mockEnv } from "../setup";
import { verifyWebhook } from "../../src/services/signatures";
import { processWebhookEvent } from "../../src/services/billing";

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("../../src/services/signatures", () => ({
  verifyWebhook: vi.fn(),
}));

vi.mock("../../src/services/billing", () => ({
  processWebhookEvent: vi.fn(),
}));

const mockedVerifyWebhook = vi.mocked(verifyWebhook);
const mockedProcessWebhookEvent = vi.mocked(processWebhookEvent);

// ─── Test Env Setup ────────────────────────────────────────────────

const env = mockEnv({
  FLUTTERWAVE_WEBHOOK_SECRET: "sk_test_abc123def456",
});

function fakeCtx(): ExecutionContext {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {},
    blockConcurrencyWork() {
      return Promise.resolve();
    },
  } as unknown as ExecutionContext;
}

// ─── Helpers ───────────────────────────────────────────────────────

function flutterwaveRequest(body: object): Request {
  const rawBody = JSON.stringify(body);
  return new Request("https://ekwe.app/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-flutterwave-signature": "test-signature",
      "x-flutterwave-timestamp": `${Math.floor(Date.now() / 1000)}`,
    },
    body: rawBody,
  });
}

// ─── Test Scenarios ────────────────────────────────────────────────

describe("Webhook Endpoint", () => {
  const ctx = fakeCtx();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /webhooks - Validation", () => {
    it("rejects payloads exceeding max size", async () => {
      const largeBody = "x".repeat(256 * 1024 + 1);
      const req = new Request("https://ekwe.app/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(largeBody.length),
          "x-flutterwave-signature": "test-signature",
          "x-flutterwave-timestamp": `${Math.floor(Date.now() / 1000)}`,
        },
        body: largeBody,
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(413);
    });

    it("returns 401 for invalid signature", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: false,
        provider: "flutterwave",
        error: "Signature mismatch",
        code: WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      });

      const req = flutterwaveRequest({ event: "test" });
      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error?: string }).error).toBe(
        WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      );
    });

    it("maps expired timestamps to WEBHOOK_TIMESTAMP_EXPIRED", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: false,
        provider: "flutterwave",
        error: "Timestamp expired",
        code: WORKER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED,
      });

      const req = flutterwaveRequest({ event: "test" });
      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error?: string }).error).toBe(
        WORKER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED,
      );
    });

    it("returns 400 for malformed JSON body", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      const req = new Request("https://ekwe.app/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-flutterwave-signature": "test-signature",
          "x-flutterwave-timestamp": `${Math.floor(Date.now() / 1000)}`,
        },
        body: "not-valid-json",
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /webhooks - Happy Path", () => {
    it("processes a valid webhook event successfully", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      const responseBody = { ok: true, message: "Processed" };
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json(responseBody, { status: 200 }),
        fullyApplied: true,
      });

      const req = flutterwaveRequest({
        id: 12345,
        event: "charge.completed",
        data: { amount: 1000, currency: "NGN" },
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(responseBody);
      expect(mockedProcessWebhookEvent).toHaveBeenCalledWith(
        "flutterwave",
        {
          id: 12345,
          event: "charge.completed",
          data: { amount: 1000, currency: "NGN" },
        },
        env,
      );
    });
  });

  describe("POST /webhooks - Idempotency", () => {
    it("returns duplicate response for already-processed event", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      // First call succeeds
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ ok: true }, { status: 200 }),
        fullyApplied: true,
      });

      const event = { id: 99999, event: "charge.completed", data: {} };

      // First call claims the idempotency key atomically in D1 and processes.
      const req1 = flutterwaveRequest(event);
      const res1 = await handleWebhook(req1, env, ctx);
      expect(res1.status).toBe(200);

      // Second (duplicate) delivery: the key is already claimed, so it is
      // dropped without re-running the event processor.
      mockedProcessWebhookEvent.mockClear();
      const req2 = flutterwaveRequest(event);
      const res2 = await handleWebhook(req2, env, ctx);
      const body = (await res2.json()) as Record<string, unknown>;
      expect(body.action).toBe("duplicate");
      expect(mockedProcessWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe("POST /webhooks - Error Handling", () => {
    it("returns 500 when processWebhookEvent fails to fully apply", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "DB_ERROR" }, { status: 500 }),
        fullyApplied: false,
      });

      const req = flutterwaveRequest({
        id: 11111,
        event: "charge.completed",
        data: {},
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(500);
    });

    it("releases the idempotency claim so a retry can reprocess a failed grant", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      const event = { id: 55555, event: "charge.completed", data: {} };

      // First delivery fails to fully apply (e.g. Supabase down) → 500 + claim released.
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "DB_ERROR" }, { status: 500 }),
        fullyApplied: false,
      });
      const res1 = await handleWebhook(flutterwaveRequest(event), env, ctx);
      expect(res1.status).toBe(500);

      // Re-delivery now reprocesses (not dropped as a duplicate) and succeeds.
      // A fresh Request is required — a Request body is single-use.
      mockedProcessWebhookEvent.mockClear();
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ ok: true }, { status: 200 }),
        fullyApplied: true,
      });
      const res2 = await handleWebhook(flutterwaveRequest(event), env, ctx);
      expect(res2.status).toBe(200);
      expect(mockedProcessWebhookEvent).toHaveBeenCalledTimes(1);
    });

    it("returns 500 for unknown event types", async () => {
      mockedVerifyWebhook.mockResolvedValue({
        isValid: true,
        provider: "flutterwave",
      });

      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 }),
        fullyApplied: true,
      });

      const req = flutterwaveRequest({
        id: 22222,
        event: "unknown.event",
        data: {},
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(400);
    });
  });
});
