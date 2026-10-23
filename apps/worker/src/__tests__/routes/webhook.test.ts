import { describe, it, expect, vi, beforeEach } from "vitest";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { handleWebhook } from "@/routes/webhook";
import { jsonBody, mockEnv } from "@/__tests__/setup";
import { processWebhookEvent } from "@/services/billing";

vi.mock("@/services/billing", () => ({
  processWebhookEvent: vi.fn(),
}));

const mockedProcessWebhookEvent = vi.mocked(processWebhookEvent);

const SECRET = "sk_test_abc123def456";

const env = mockEnv({
  FLUTTERWAVE_WEBHOOK_SECRET: SECRET,
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

async function flutterwaveSignedRequest(body: string): Promise<Request> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  const signature = btoa(binary);

  return new Request("https://ekwe.app/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "verif-hash": SECRET,
      "flutterwave-signature": signature,
      "x-flutterwave-timestamp": `${Math.floor(Date.now() / 1000)}`,
    },
    body,
  });
}

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

    it("returns 401 for an unsigned or mismatched signature", async () => {
      const req = new Request("https://ekwe.app/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "verif-hash": "bogus",
          "x-flutterwave-timestamp": `${Math.floor(Date.now() / 1000)}`,
        },
        body: JSON.stringify({ event: "test" }),
      });

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(401);
      expect((await jsonBody(res)).error).toBe(
        WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      );
    });

    it("returns 400 for malformed JSON body", async () => {
      const req = await flutterwaveSignedRequest("not-valid-json");

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /webhooks - Happy Path", () => {
    it("processes a valid webhook event successfully", async () => {
      const responseBody = { ok: true, message: "Processed" };
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json(responseBody, { status: 200 }),
        fullyApplied: true,
      });

      const req = await flutterwaveSignedRequest(
        JSON.stringify({
          id: 12345,
          event: "charge.completed",
          data: { amount: 1000, currency: "NGN" },
        }),
      );

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual(responseBody);
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
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ ok: true }, { status: 200 }),
        fullyApplied: true,
      });

      const event = { id: 99999, event: "charge.completed", data: {} };
      const raw = JSON.stringify(event);

      const res1 = await handleWebhook(
        await flutterwaveSignedRequest(raw),
        env,
        ctx,
      );
      expect(res1.status).toBe(200);

      mockedProcessWebhookEvent.mockClear();
      const res2 = await handleWebhook(
        await flutterwaveSignedRequest(raw),
        env,
        ctx,
      );
      const body = await jsonBody(res2);
      expect(body.action).toBe("duplicate");
      expect(mockedProcessWebhookEvent).not.toHaveBeenCalled();
    });

    it("fails closed with a retryable 500 when the claim errors, without processing", async () => {
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ ok: true }, { status: 200 }),
        fullyApplied: true,
      });

      const throwingD1 = {
        prepare() {
          throw new Error("D1 unavailable");
        },
      } as unknown as Env["DB"];

      const req = await flutterwaveSignedRequest(
        JSON.stringify({ id: 88888, event: "charge.completed", data: {} }),
      );

      const res = await handleWebhook(
        req,
        mockEnv({ FLUTTERWAVE_WEBHOOK_SECRET: SECRET, DB: throwingD1 }),
        ctx,
      );
      expect(res.status).toBe(500);
      expect(mockedProcessWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe("POST /webhooks - Error Handling", () => {
    it("returns 500 when processWebhookEvent fails to fully apply", async () => {
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "DB_ERROR" }, { status: 500 }),
        fullyApplied: false,
      });

      const req = await flutterwaveSignedRequest(
        JSON.stringify({ id: 11111, event: "charge.completed", data: {} }),
      );

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(500);
    });

    it("releases the idempotency claim so a retry can reprocess a failed grant", async () => {
      const event = { id: 55555, event: "charge.completed", data: {} };
      const raw = JSON.stringify(event);

      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "DB_ERROR" }, { status: 500 }),
        fullyApplied: false,
      });
      const res1 = await handleWebhook(
        await flutterwaveSignedRequest(raw),
        env,
        ctx,
      );
      expect(res1.status).toBe(500);

      mockedProcessWebhookEvent.mockClear();
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ ok: true }, { status: 200 }),
        fullyApplied: true,
      });
      const res2 = await handleWebhook(
        await flutterwaveSignedRequest(raw),
        env,
        ctx,
      );
      expect(res2.status).toBe(200);
      expect(mockedProcessWebhookEvent).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for unknown event types", async () => {
      mockedProcessWebhookEvent.mockResolvedValue({
        response: Response.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 }),
        fullyApplied: true,
      });

      const req = await flutterwaveSignedRequest(
        JSON.stringify({ id: 22222, event: "unknown.event", data: {} }),
      );

      const res = await handleWebhook(req, env, ctx);
      expect(res.status).toBe(400);
    });
  });
});
