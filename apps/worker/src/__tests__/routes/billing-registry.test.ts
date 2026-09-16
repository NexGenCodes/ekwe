import { describe, test, expect, beforeEach } from "vitest";
import {
  registerProvider,
  getProvider,
  hasProvider,
  processWebhookEvent,
  unknownProvider,
} from "../../services/billing";
// Side-effect imports: trigger self-registration of built-in providers.
import "../../routes/webhook";
import "../../routes/flutterwave";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { mockEnv, jsonResponse } from "../setup";
import { server } from "../msw/server";

describe("Provider Registry", () => {
  beforeEach(() => {
    // Clear all providers registered during tests by re-registering
    // the built-in ones (they self-register on import)
    server.resetHandlers();
  });

  test("hasProvider returns true for registered providers", () => {
    // "flutterwave" is registered at module load time
    expect(hasProvider("flutterwave")).toBe(true);
  });

  test("hasProvider returns false for unknown providers", () => {
    expect(hasProvider("stripe")).toBe(false);
    expect(hasProvider("paypal")).toBe(false);
  });

  test("getProvider returns the config for a registered provider", () => {
    const fw = getProvider("flutterwave");
    expect(fw).toBeDefined();
    expect(typeof fw!.enabled).toBe("function");
    expect(typeof fw!.process).toBe("function");
  });

  test("getProvider returns undefined for unknown providers", () => {
    expect(getProvider("nonexistent")).toBeUndefined();
  });

  test("unknownProvider returns 400 UNKNOWN_PROVIDER", async () => {
    const env = mockEnv();
    const result = await unknownProvider({}, env);
    expect(result.fullyApplied).toBe(true);
    expect(result.response.status).toBe(400);
    const body = (await result.response.json()) as any;
    expect(body.error).toBe(WORKER_ERROR_CODES.UNKNOWN_PROVIDER);
  });

  test("processWebhookEvent delegates to registered provider", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET: "fw-test" });
    let processedEvent: Record<string, unknown> | null = null;

    registerProvider("test-provider", {
      enabled: () => true,
      process: async (event) => {
        processedEvent = event;
        return {
          response: jsonResponse({ received: true }),
          fullyApplied: true,
        };
      },
    });

    const event = { id: 1, event: "test.event", data: {} };
    const result = await processWebhookEvent("test-provider", event, env);
    expect(result.fullyApplied).toBe(true);
    expect(result.response.status).toBe(200);
    expect(processedEvent).toEqual(event);
  });

  test("processWebhookEvent returns 503 for disabled provider", async () => {
    const env = mockEnv({}); // No FLUTTERWAVE_SECRET

    registerProvider("disabled-provider", {
      enabled: (e) => !!e.FLUTTERWAVE_SECRET,
      process: async () => ({
        response: jsonResponse({ received: true }),
        fullyApplied: true,
      }),
    });

    const result = await processWebhookEvent("disabled-provider", {}, env);
    expect(result.fullyApplied).toBe(true);
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as any;
    expect(body.error).toBe(WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE);
  });

  test("processWebhookEvent returns 400 for unknown provider", async () => {
    const env = mockEnv();
    const result = await processWebhookEvent("nonexistent", {}, env);
    expect(result.fullyApplied).toBe(true);
    expect(result.response.status).toBe(400);
    const body = (await result.response.json()) as any;
    expect(body.error).toBe(WORKER_ERROR_CODES.UNKNOWN_PROVIDER);
  });

  test("flutterwave provider is enabled when FLUTTERWAVE_WEBHOOK_SECRET is set", () => {
    const env = mockEnv({ FLUTTERWAVE_WEBHOOK_SECRET: "fw-secret" });
    const fw = getProvider("flutterwave");
    expect(fw!.enabled(env)).toBe(true);
  });

  test("flutterwave provider is disabled when FLUTTERWAVE_WEBHOOK_SECRET is missing", () => {
    const env = mockEnv({});
    const fw = getProvider("flutterwave");
    expect(fw!.enabled(env)).toBe(false);
  });

  test("registerProvider overwrites existing provider with same name", async () => {
    const env = mockEnv();
    let callCount = 0;

    registerProvider("overwrite-test", {
      enabled: () => true,
      process: async () => {
        callCount++;
        return { response: jsonResponse({ v: 1 }), fullyApplied: true };
      },
    });

    await processWebhookEvent("overwrite-test", {}, env);
    expect(callCount).toBe(1);

    registerProvider("overwrite-test", {
      enabled: () => true,
      process: async () => {
        callCount += 10;
        return { response: jsonResponse({ v: 2 }), fullyApplied: true };
      },
    });

    await processWebhookEvent("overwrite-test", {}, env);
    expect(callCount).toBe(11); // 1 + 10
  });
});
