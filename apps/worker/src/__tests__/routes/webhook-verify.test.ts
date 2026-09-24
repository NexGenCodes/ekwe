import { describe, it, expect } from "vitest";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { verifyWebhook } from "@/routes/webhook";

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

describe("verifyWebhook", () => {
  describe("Flutterwave signature verification", () => {
    const secret = "sk_test_abc123def456";

    it("rejects requests with no signature headers", async () => {
      const req = makeRequest({ body: '{"event":"charge.completed"}' });
      const result = await verifyWebhook(req, '{"event":"charge.completed"}', {
        FLUTTERWAVE_WEBHOOK_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("unknown");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS);
    });

    it("accepts a valid verif-hash header (plain secret hash)", async () => {
      const body = '{"event":"charge.completed","data":{"id":123}}';
      const req = makeRequest({
        body,
        headers: {
          "verif-hash": secret,
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_WEBHOOK_SECRET: secret,
      });
      expect(result.isValid).toBe(true);
      expect(result.provider).toBe("flutterwave");
    });

    it("accepts a valid flutterwave-signature header (HMAC-SHA256 base64)", async () => {
      const body = '{"event":"charge.completed","data":{"id":123}}';

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(body),
      );
      const bytes = new Uint8Array(sigBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const expectedSig = btoa(binary);

      const req = makeRequest({
        body,
        headers: {
          "flutterwave-signature": expectedSig,
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_WEBHOOK_SECRET: secret,
      });
      expect(result.isValid).toBe(true);
      expect(result.provider).toBe("flutterwave");
    });

    it("rejects an invalid verif-hash", async () => {
      const body = '{"event":"charge.completed"}';
      const req = makeRequest({
        body,
        headers: {
          "verif-hash": "wrong-secret-value",
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_WEBHOOK_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("flutterwave");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID);
    });

    it("rejects an invalid flutterwave-signature", async () => {
      const body = '{"event":"charge.completed"}';
      const req = makeRequest({
        body,
        headers: {
          "flutterwave-signature": "aGVsbG8=",
        },
      });
      const result = await verifyWebhook(req, body, {
        FLUTTERWAVE_WEBHOOK_SECRET: secret,
      });
      expect(result.isValid).toBe(false);
      expect(result.provider).toBe("flutterwave");
      expect(result.code).toBe(WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID);
    });

    it("rejects when FLUTTERWAVE_WEBHOOK_SECRET is missing", async () => {
      const body = '{"event":"charge.completed"}';
      const req = makeRequest({
        body,
        headers: {
          "verif-hash": secret,
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
