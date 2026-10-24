import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/core/types";

const jose = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jose.jwtVerify,
}));

import { checkBot } from "@/auth/guards";

const APP_CHECK_ISSUER = "https://firebaseappcheck.googleapis.com/";

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    FIREBASE_PROJECT_NUMBER: "239869950724",
    REQUIRE_APP_CHECK: "false",
    APP_ENV: "production",
    TURNSTILE_SECRET: "turnstile-secret",
    TURNSTILE_HOSTNAMES: "ekwe.pages.dev",
    ...overrides,
  } as unknown as Env;
}

function makeRequest(): Request {
  return new Request("https://ekwe-proxy.workers.dev/auth/otp", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.1" },
  });
}

function turnstileResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("checkBot", () => {
  beforeEach(() => {
    jose.jwtVerify.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a valid App Check token without calling Turnstile", async () => {
    jose.jwtVerify.mockResolvedValue({
      payload: { iss: APP_CHECK_ISSUER },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBot(makeRequest(), makeEnv(), {
      appCheckToken: "valid-app-check-token",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Turnstile when the App Check token is invalid", async () => {
    jose.jwtVerify.mockRejectedValue(new Error("invalid App Check token"));
    const fetchMock = vi.fn(async () =>
      turnstileResponse({
        success: true,
        action: "send_otp",
        hostname: "ekwe.pages.dev",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkBot(makeRequest(), makeEnv(), {
      appCheckToken: "invalid-app-check-token",
      turnstileToken: "valid-turnstile-token",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects when both App Check and Turnstile are invalid", async () => {
    jose.jwtVerify.mockRejectedValue(new Error("invalid App Check token"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        turnstileResponse({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      ),
    );

    const result = await checkBot(makeRequest(), makeEnv(), {
      appCheckToken: "invalid-app-check-token",
      turnstileToken: "invalid-turnstile-token",
    });

    expect(result).toEqual({
      ok: false,
      code: "TURNSTILE_INVALID",
      status: 403,
    });
  });

  it("allows an invalid token when enforcement is off and no Turnstile is supplied", async () => {
    jose.jwtVerify.mockRejectedValue(new Error("invalid App Check token"));

    const result = await checkBot(makeRequest(), makeEnv(), {
      appCheckToken: "invalid-app-check-token",
    });

    expect(result).toEqual({ ok: true });
  });

  it("reports an invalid App Check token when enforcement is on", async () => {
    jose.jwtVerify.mockRejectedValue(new Error("invalid App Check token"));

    const result = await checkBot(
      makeRequest(),
      makeEnv({ REQUIRE_APP_CHECK: "true" }),
      { appCheckToken: "invalid-app-check-token" },
    );

    expect(result).toEqual({
      ok: false,
      code: "APP_CHECK_INVALID",
      status: 403,
    });
  });

  it("requires App Check when enforcement is on and no token is supplied", async () => {
    const result = await checkBot(
      makeRequest(),
      makeEnv({ REQUIRE_APP_CHECK: "true" }),
      {},
    );

    expect(result).toEqual({
      ok: false,
      code: "APP_CHECK_REQUIRED",
      status: 403,
    });
  });

  it("allows a missing token when enforcement is off", async () => {
    const result = await checkBot(makeRequest(), makeEnv(), {});

    expect(result).toEqual({ ok: true });
  });
});
