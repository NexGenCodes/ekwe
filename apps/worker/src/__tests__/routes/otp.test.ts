import { describe, test, expect } from "vitest";
import { handleSendOtp } from "../../routes/otp";
import { mockEnv } from "../setup";

function otpRequest(body: string): Request {
  return new Request("http://test/auth/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("handleSendOtp body guard", () => {
  test("rejects oversized JSON bodies before Turnstile verification", async () => {
    const env = mockEnv();
    // A ~200KB token should be capped by safeParseJSON (128KB default) before
    // the body is consumed or Turnstile/rate-limit logic runs.
    const oversized = JSON.stringify({
      email: "a@b.co",
      turnstileToken: "x".repeat(200_000),
    });
    const res = await handleSendOtp(otpRequest(oversized), env);
    expect(res.status).toBe(413);
    expect((await res.json()) as any).toEqual(
      expect.objectContaining({ error: "PAYLOAD_TOO_LARGE" }),
    );
  });

  test("rejects malformed JSON with 400", async () => {
    const env = mockEnv();
    const res = await handleSendOtp(otpRequest("{not-json"), env);
    expect(res.status).toBe(400);
    expect((await res.json()) as any).toEqual(
      expect.objectContaining({ error: "INVALID_JSON" }),
    );
  });
});
