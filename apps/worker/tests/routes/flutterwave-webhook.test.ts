import { describe, it, expect, vi, beforeEach } from "vitest";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { handleFlutterwaveWebhook } from "../../src/routes/flutterwave";
import { mockEnv } from "../setup";
import { verifyWebhook } from "../../src/services/signatures";
import { processWebhookEvent } from "../../src/services/billing";

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("../../src/services/signatures", () => ({
  verifyWebhook: vi.fn(),
}));

vi.mock("../../src/services/billing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/billing")>();
  return {
    ...actual,
    processWebhookEvent: vi.fn(),
  };
});

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

// ─── Test Scenarios ────────────────────────────────────────────────

describe("POST /webhook/flutterwave - Signature Verification", () => {
  const ctx = fakeCtx();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for invalid signature", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      isValid: false,
      provider: "flutterwave",
      error: "Signature mismatch",
      code: WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
    });

    const req = new Request("https://ekwe.app/webhook/flutterwave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "verif-hash": "wrong-hash",
      },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    });

    const res = await handleFlutterwaveWebhook(req, env, ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(
      WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
    );
  });

  it("returns 401 for requests with no signature headers", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      isValid: false,
      provider: "unknown",
      error: "Missing signature headers",
      code: WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
    });

    const req = new Request("https://ekwe.app/webhook/flutterwave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    });

    const res = await handleFlutterwaveWebhook(req, env, ctx);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(
      WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
    );
  });

  it("processes a valid signed webhook event", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      isValid: true,
      provider: "flutterwave",
    });

    const responseBody = { received: true, action: "activated" };
    mockedProcessWebhookEvent.mockResolvedValue({
      response: Response.json(responseBody, { status: 200 }),
      fullyApplied: true,
    });

    const event = {
      id: 55555,
      event: "charge.success",
      data: { id: 55555, tx_ref: "ekwe_test_1_monthly" },
    };
    const req = new Request("https://ekwe.app/webhook/flutterwave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "verif-hash": "sk_test_abc123def456",
      },
      body: JSON.stringify(event),
    });

    const res = await handleFlutterwaveWebhook(req, env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(responseBody);
    expect(mockedProcessWebhookEvent).toHaveBeenCalledWith(
      "flutterwave",
      event,
      env,
    );
  });

  it("returns 500 when the event is not fully applied", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      isValid: true,
      provider: "flutterwave",
    });

    mockedProcessWebhookEvent.mockResolvedValue({
      response: Response.json({ error: "DB_ERROR" }, { status: 500 }),
      fullyApplied: false,
    });

    const req = new Request("https://ekwe.app/webhook/flutterwave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "verif-hash": "sk_test_abc123def456",
      },
      body: JSON.stringify({ event: "charge.success", data: {} }),
    });

    const res = await handleFlutterwaveWebhook(req, env, ctx);
    expect(res.status).toBe(500);
  });

  it("returns 400 for malformed JSON body", async () => {
    mockedVerifyWebhook.mockResolvedValue({
      isValid: true,
      provider: "flutterwave",
    });

    const req = new Request("https://ekwe.app/webhook/flutterwave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "verif-hash": "sk_test_abc123def456",
      },
      body: "not-valid-json",
    });

    const res = await handleFlutterwaveWebhook(req, env, ctx);
    expect(res.status).toBe(400);
  });
});
