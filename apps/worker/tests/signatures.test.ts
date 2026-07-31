import { describe, test, expect } from "vitest";
import { verifyWebhook } from "../src/signatures";
import { hexEncode } from "../src/utils/keys";
import { mockEnv } from "./setup";

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

function makeRequest(
  headers: Record<string, string>,
  body: string,
): Request {
  return new Request("http://test/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("verifyWebhook", () => {
  const body = JSON.stringify({ event: "charge.success", data: {} });

  test("accepts a valid Paystack HMAC-SHA512 signature", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "paystack-secret" });
    const sig = await hmac(body, "paystack-secret", "SHA-512");
    const res = await verifyWebhook(
      makeRequest({ "x-paystack-signature": sig }, body),
      body,
      env,
    );
    expect(res).toEqual({ isValid: true, provider: "paystack" });
  });

  test("rejects a mismatched Paystack signature", async () => {
    const env = mockEnv({ PAYSTACK_SECRET_KEY: "paystack-secret" });
    const res = await verifyWebhook(
      makeRequest({ "x-paystack-signature": "deadbeef" }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.provider).toBe("paystack");
  });

  test("reports misconfiguration when Paystack secret is missing", async () => {
    const env = mockEnv();
    const sig = await hmac(body, "anything", "SHA-512");
    const res = await verifyWebhook(
      makeRequest({ "x-paystack-signature": sig }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toBe("Server misconfiguration");
  });

  test("accepts a valid Flutterwave secret hash", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const res = await verifyWebhook(
      makeRequest({ "verif-hash": "fw-hash" }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe("flutterwave");
  });

  test("rejects a mismatched Flutterwave secret hash", async () => {
    const env = mockEnv({ FLUTTERWAVE_SECRET_HASH: "fw-hash" });
    const res = await verifyWebhook(
      makeRequest({ "verif-hash": "wrong" }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.provider).toBe("flutterwave");
  });

  test("reports misconfiguration when Flutterwave secret is missing", async () => {
    const env = mockEnv();
    const res = await verifyWebhook(
      makeRequest({ "verif-hash": "fw-hash" }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toBe("Server misconfiguration");
  });

  test("accepts a valid RevenueCat HMAC-SHA256 signature", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const sig = await hmac(body, "rc-secret", "SHA-256");
    const res = await verifyWebhook(
      makeRequest({ "x-revenuecat-signature": sig }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe("revenuecat");
  });

  test("rejects a mismatched RevenueCat signature", async () => {
    const env = mockEnv({ REVENUECAT_WEBHOOK_SECRET: "rc-secret" });
    const res = await verifyWebhook(
      makeRequest({ "x-revenuecat-signature": "beef" }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.provider).toBe("revenuecat");
  });

  test("reports misconfiguration when RevenueCat secret is missing", async () => {
    const env = mockEnv();
    const sig = await hmac(body, "anything", "SHA-256");
    const res = await verifyWebhook(
      makeRequest({ "x-revenuecat-signature": sig }, body),
      body,
      env,
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toBe("Server misconfiguration");
  });

  test("rejects requests with no signature headers", async () => {
    const env = mockEnv();
    const res = await verifyWebhook(makeRequest({}, body), body, env);
    expect(res).toEqual({
      isValid: false,
      provider: "unknown",
      error: "Missing signature headers",
    });
  });
});
