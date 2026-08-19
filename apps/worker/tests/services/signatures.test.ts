import { describe, it, expect } from "vitest";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { verifyWebhook } from "../../src/services/signatures";

// ─── Helpers ───────────────────────────────────────────────────────

function makeRequest(opts: {
  headers?: Record<string, string>;
  body?: string;
}) {
  return new Request("https://ekwe.app/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: opts.body ?? "{}",
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("verifyWebhook", () => {
  // ── FLUTTERWAVE (HMAC-SHA512) ──
  describe("Flutterwave signature verification", () => {
    const secret = "sk_test_abc123def456";

    it("rejects requests with no signature headers", async () => {
      const req = makeRequest({ body: '{"event":"charge.completed"}' });
      const result = await verifyWebhook(req, '{"event":"charge.completed"}', {
        FLUTTERWAVE_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("unknown");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS);
    });

    it("accepts valid Flutterwave signature", async () => {
      const body = '{"event":"charge.completed","data":{"id":123}}';
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Compute expected signature: HMAC-SHA512(secret + timestamp + body)
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"],
      );
      const sigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${secret}${timestamp}${body}`),
      );
      const expectedSig = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const req = makeRequest({
        body,
        headers: {
          "x-flutterwave-signature": expectedSig,
          "x-flutterwave-timestamp": timestamp,
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_SECRET: secret,
      });
      expect(result.isValid).toBe(true);
      expect(result.provider).toBe("flutterwave");
    });

    it("rejects invalid Flutterwave signature", async () => {
      const body = '{"event":"charge.completed"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const req = makeRequest({
        body,
        headers: {
          "x-flutterwave-signature": "a".repeat(128),
          "x-flutterwave-timestamp": timestamp,
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("flutterwave");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID);
    });

    it("rejects expired Flutterwave timestamp", async () => {
      const body = '{"event":"charge.completed"}';
      const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const req = makeRequest({
        body,
        headers: {
          "x-flutterwave-signature": "irrelevant",
          "x-flutterwave-timestamp": staleTimestamp,
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("flutterwave");
      expect(result.error).toBe("Timestamp expired");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED);
    });

    it("rejects when FLUTTERWAVE_SECRET is missing", async () => {
      const body = '{"event":"charge.completed"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const req = makeRequest({
        body,
        headers: {
          "x-flutterwave-signature": "sig",
          "x-flutterwave-timestamp": timestamp,
        },
      });
      const result = await verifyWebhook(req, body, {});
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("flutterwave");
      expect(result.error).toBe("Server misconfiguration");
      expect(result.code).toBe(WORKER_ERROR_CODES.SERVER_ERROR);
    });
  });
});
