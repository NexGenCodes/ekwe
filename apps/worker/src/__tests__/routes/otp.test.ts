import { describe, test, expect, vi, beforeEach } from "vitest";
import { handleSendOtp, resetTurnstileAlertCache } from "@/routes/otp";
import { mockEnv } from "@/__tests__/setup";
import { logger } from "@/core/logger";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";

const TURNSTILE_SITEVERIFY =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function otpRequest(body: string): Request {
  return new Request("http://test/auth/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function throwingThrottleDo() {
  return {
    getByName() {
      return {
        fetch: async () => {
          throw new Error("THROTTLE_DO unavailable");
        },
      };
    },
  } as unknown as Env["THROTTLE_DO"];
}

describe("handleSendOtp body guard", () => {
  test("rejects oversized JSON bodies before Turnstile verification", async () => {
    const env = mockEnv();

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

describe("Turnstile fail-open alerting", () => {
  beforeEach(() => {
    resetTurnstileAlertCache();
    vi.restoreAllMocks();
  });

  test("logs a deduped Sentry-bound alert when siteverify is degraded", async () => {
    server.use(
      http.post(
        TURNSTILE_SITEVERIFY,
        () => new Response("upstream down", { status: 500 }),
      ),
    );
    const spy = vi.spyOn(logger, "error");
    const env = mockEnv({
      TURNSTILE_SECRET: "test-secret",
      APP_ENV: "production",
      REQUIRE_APP_CHECK: "true",
    });
    const req = () =>
      new Request("http://test/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", turnstileToken: "tok" }),
      });

    await handleSendOtp(req(), env);
    await handleSendOtp(req(), env);

    const alerts = spy.mock.calls.filter(([msg]) =>
      String(msg).includes("Turnstile degraded"),
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0]![0]).toContain("siteverify_non_ok");
  });
});

describe("handleSendOtp throttle fail-closed", () => {
  test("denies the request in production when the throttle DO errors", async () => {
    const env = mockEnv({
      APP_ENV: "production",
      THROTTLE_DO: throwingThrottleDo(),
    });
    const res = await handleSendOtp(
      otpRequest(JSON.stringify({ email: "throttle@test.dev" })),
      env,
    );
    expect(res.status).toBe(429);
  });

  test("fails open in development when the throttle DO errors", async () => {
    server.use(
      http.post("https://mock.supabase.co/auth/v1/otp", () =>
        Response.json({ ok: true }, { status: 200 }),
      ),
    );
    const env = mockEnv({
      APP_ENV: "development",
      THROTTLE_DO: throwingThrottleDo(),
    });
    const res = await handleSendOtp(
      otpRequest(
        JSON.stringify({ email: "dev-open@test.dev", turnstileToken: "x" }),
      ),
      env,
    );
    expect(res.status).toBe(200);
  });
});
