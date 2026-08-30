import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkPreflight, runPreflightGate } from "../../src/services/preflight";
import { mockEnv, jsonResponse } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

describe("checkPreflight (cooldown + quota gate)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 25,
          quota_remaining: 25,
        }),
      ),
    );
  });

  test("sends both tiers' per-type limits and usage type for FREE translate", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 25,
          quota_remaining: 24,
        });
      }),
    );

    const res = await checkPreflight(
      mockEnv(),
      "uid-1",
      "FREE",
      "translate",
      null,
    );

    expect(body).toMatchObject({
      p_user_id: "uid-1",
      p_type: "translate",
      p_free_cooldown_seconds: 3,
      p_free_daily_limit: 25,
      p_premium_cooldown_seconds: 1,
      p_premium_daily_limit: 0,
      p_premium_throttle_threshold: 500,
      p_throttle_cooldown_seconds: 3,
    });
    expect(res.quota_remaining).toBe(24);
  });

  test("sends the unlimited premium transcribe limit with its throttle threshold", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ allowed: true, tier_active: "PREMIUM" });
      }),
    );

    await checkPreflight(mockEnv(), "uid-2", "PREMIUM", "transcribe", null);

    expect(body).toMatchObject({
      p_type: "transcribe",
      p_premium_daily_limit: 0,
      p_premium_throttle_threshold: 500,
      p_free_daily_limit: 25,
      p_throttle_cooldown_seconds: 3,
    });
  });

  test("sends the unlimited premium translate limit with its throttle threshold", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ allowed: true, tier_active: "PREMIUM" });
      }),
    );

    await checkPreflight(mockEnv(), "uid-5", "PREMIUM", "translate", null);

    expect(body).toMatchObject({
      p_type: "translate",
      p_premium_daily_limit: 0,
      p_premium_throttle_threshold: 500,
      p_free_daily_limit: 25,
      p_throttle_cooldown_seconds: 3,
    });
  });

  test("sends the premium tts char limit and this request's charge for a tts gate", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ allowed: true, tier_active: "PREMIUM" });
      }),
    );

    await checkPreflight(mockEnv(), "uid-tts", "PREMIUM", "tts", null, 42);

    expect(body).toMatchObject({
      p_type: "tts",
      p_free_daily_limit: 0,
      p_premium_tts_chars_limit: 5000,
      p_charge_chars: 42,
      p_premium_throttle_threshold: 0,
    });
  });

  test("sends a zero char charge for non-tts usage types", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ allowed: true, tier_active: "FREE" });
      }),
    );

    await checkPreflight(mockEnv(), "uid-free", "FREE", "translate", null);

    expect(body).toMatchObject({
      p_type: "translate",
      p_charge_chars: 0,
    });
  });

  test("fails closed to PREFLIGHT_UNAVAILABLE when the RPC returns an error", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({ error: "boom" }, 500),
      ),
    );

    const res = await checkPreflight(
      mockEnv(),
      "uid-3",
      "FREE",
      "translate",
      null,
    );

    expect(res).toMatchObject({
      allowed: false,
      tier_active: "FREE",
      reason: "PREFLIGHT_UNAVAILABLE",
    });
  });

  test("fails closed to PREFLIGHT_CONFIG_ERROR when env vars are missing", async () => {
    const res = await checkPreflight(
      mockEnv({ SUPABASE_SERVICE_ROLE_KEY: "" }),
      "uid-4",
      "FREE",
      "translate",
      null,
    );

    expect(res).toMatchObject({
      allowed: false,
      reason: "PREFLIGHT_CONFIG_ERROR",
    });
  });

  test("rejects with SESSION_INACTIVE when the session was revoked", async () => {
    let sessionBody: Record<string, unknown> = {};
    server.use(
      http.post(
        PROVIDER_URLS.supabaseCheckSessionActive,
        async ({ request }) => {
          sessionBody = (await request.json()) as Record<string, unknown>;
          return jsonResponse(false);
        },
      ),
    );

    const res = await checkPreflight(
      mockEnv(),
      "uid-6",
      "FREE",
      "translate",
      "session-abc",
    );

    expect(sessionBody).toMatchObject({ p_session_id: "session-abc" });
    expect(res).toMatchObject({
      allowed: false,
      tier_active: "FREE",
      reason: "SESSION_INACTIVE",
    });
  });

  test("fails open when the session-active RPC errors, still gating on quota", async () => {
    let preflightCalls = 0;
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckSessionActive, () =>
        jsonResponse({ error: "boom" }, 500),
      ),
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
        preflightCalls += 1;
        return jsonResponse({ allowed: true, tier_active: "FREE" });
      }),
    );

    const res = await checkPreflight(
      mockEnv(),
      "uid-7",
      "FREE",
      "translate",
      "session-def",
    );

    expect(preflightCalls).toBe(1);
    expect(res.allowed).toBe(true);
  });
});

describe("runPreflightGate (cached cooldown + quota gate)", () => {
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function rpcSpy() {
    let calls = 0;
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
        calls += 1;
        return jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 25,
          quota_remaining: 24,
        });
      }),
    );
    return () => calls;
  }

  test("runs the RPC on a cache miss and stores the gated result with its usage type", async () => {
    const env = mockEnv();
    const calls = rpcSpy();

    const gate = await runPreflightGate(
      env,
      ctx,
      "uid-g1",
      "FREE",
      "translate",
      null,
    );

    expect(gate.ok).toBe(true);
    expect(calls()).toBe(1);
    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      "preflight:uid-g1",
      expect.any(String),
      { expirationTtl: 2 },
    );
    const stored = JSON.parse(
      (env.EKWE_KV.put as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1],
    );
    expect(stored.usage_type).toBe("translate");
  });

  test("reuses the cache on a matching usage type without re-running the RPC", async () => {
    const env = mockEnv();
    const calls = rpcSpy();

    await runPreflightGate(env, ctx, "uid-g2", "FREE", "translate", null);
    expect(calls()).toBe(1);

    const second = await runPreflightGate(
      env,
      ctx,
      "uid-g2",
      "FREE",
      "translate",
      null,
    );
    expect(second.ok).toBe(true);
    expect(calls()).toBe(1);
  });

  test("misses the cache and re-runs the RPC when the usage type differs", async () => {
    const env = mockEnv();
    const calls = rpcSpy();

    await runPreflightGate(env, ctx, "uid-g3", "FREE", "translate", null);
    expect(calls()).toBe(1);

    const second = await runPreflightGate(
      env,
      ctx,
      "uid-g3",
      "FREE",
      "transcribe",
      null,
    );
    expect(second.ok).toBe(true);
    expect(calls()).toBe(2);
  });

  test("returns a 429 EKWE_QUOTA_EXCEEDED response when the quota is exhausted", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: false,
          reason: "QUOTA_EXCEEDED",
          quota_total: 25,
          quota_remaining: 0,
        }),
      ),
    );

    const gate = await runPreflightGate(
      mockEnv(),
      ctx,
      "uid-g4",
      "FREE",
      "translate",
      null,
    );

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(429);
      expect(gate.response.headers.get("Retry-After")).toBeTruthy();
      const body = await gate.response.json();
      expect(body).toMatchObject({
        error: "EKWE_QUOTA_EXCEEDED",
        quota_total: 25,
        quota_remaining: 0,
      });
    }
  });

  test("returns a 429 EKWE_RATE_LIMIT response with the remaining cooldown", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: false,
          reason: "RATE_LIMIT",
          cooldown_remaining: 12.4,
        }),
      ),
    );

    const gate = await runPreflightGate(
      mockEnv(),
      ctx,
      "uid-g5",
      "FREE",
      "translate",
      null,
    );

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(429);
      expect(gate.response.headers.get("Retry-After")).toBe("13");
      const body = await gate.response.json();
      expect(body).toMatchObject({ error: "EKWE_RATE_LIMIT" });
    }
  });

  test("passes through a throttled PREMIUM response without blocking", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: true,
          tier_active: "PREMIUM",
          throttled: true,
          quota_total: 0,
          quota_remaining: 0,
        }),
      ),
    );

    const gate = await runPreflightGate(
      mockEnv(),
      ctx,
      "uid-g6",
      "PREMIUM",
      "translate",
      null,
    );

    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.preflight.throttled).toBe(true);
    }
  });

  test("returns a 401 UNAUTHORIZED response when the session is inactive", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckSessionActive, () =>
        jsonResponse(false),
      ),
    );

    const gate = await runPreflightGate(
      mockEnv(),
      ctx,
      "uid-g7",
      "FREE",
      "translate",
      "session-inactive",
    );

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(401);
      const body = await gate.response.json();
      expect(body).toMatchObject({ error: "UNAUTHORIZED" });
    }
  });
});
