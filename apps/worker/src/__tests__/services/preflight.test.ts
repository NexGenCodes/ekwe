import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkPreflight, runPreflightGate } from "@/services/preflight";
import { getLimits } from "@/core/limits";
import {
  executeQueryChunks,
  jsonBody,
  mockDb,
  mockEnv,
  mockExecutionContext,
} from "@/__tests__/setup";

/**
 * Helper: create a mockDb.execute implementation that routes by query string.
 * Production calls two RPCs concurrently:
 *   1. `check_session_active(sessionId)`  → { active: boolean }
 *   2. `check_preflight(10 args)`        → { preflight: PreflightResponse }
 *
 * The wrapper is not incidental: a scalar-returning function selected with
 * `SELECT * FROM check_preflight(...)` yields ONE column named after the
 * function, so the driver row is `{ check_preflight: {...} }`. Mocking the
 * bare object here is what let that ship and break every request.
 */
function stubPreflight(
  preflight: Record<string, unknown>,
  opts?: { sessionActive?: boolean },
) {
  mockDb.execute.mockImplementation(async (query) => {
    const q = JSON.stringify(query);
    if (q.includes("check_session_active")) {
      return [{ active: opts?.sessionActive ?? true }];
    }
    if (q.includes("check_preflight")) {
      return [{ preflight }];
    }
    return [];
  });
}

describe("checkPreflight (cooldown + quota gate)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubPreflight({
      allowed: true,
      tier_active: "FREE",
      quota_total: 25,
      quota_remaining: 25,
    });
  });

  test("sends both tiers' per-type limits and usage type for FREE translate", async () => {
    stubPreflight({
      allowed: true,
      tier_active: "FREE",
      quota_total: 25,
      quota_remaining: 24,
    });

    const res = await checkPreflight(
      mockEnv(),
      "uid-1",
      "FREE",
      "translate",
      null,
    );

    expect(res.quota_remaining).toBe(24);

    const preflightCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    expect(preflightCall).toBeDefined();
    const chunks = executeQueryChunks(preflightCall![0]);
    expect(chunks[1]).toBe("uid-1"); // userId
    expect(chunks[3]).toBe("translate"); // type
    expect(chunks[5]).toBe(3); // freeCooldownSeconds
    expect(chunks[7]).toBe(25); // freeDailyLimit
    expect(chunks[9]).toBe(1); // premiumCooldownSeconds
    expect(chunks[11]).toBe(0); // premiumDailyLimit (unlimited)
    expect(chunks[13]).toBe(500); // premiumThrottleThreshold
    expect(chunks[15]).toBe(3); // throttleCooldownSeconds
  });

  test("sends the unlimited premium transcribe limit with its throttle threshold", async () => {
    stubPreflight({ allowed: true, tier_active: "PREMIUM" });

    await checkPreflight(mockEnv(), "uid-2", "PREMIUM", "transcribe", null);

    const preflightCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    const chunks = executeQueryChunks(preflightCall![0]);
    expect(chunks[3]).toBe("transcribe");
    expect(chunks[11]).toBe(0);
    expect(chunks[13]).toBe(500);
    expect(chunks[7]).toBe(25);
    expect(chunks[15]).toBe(3);
  });

  test("sends the unlimited premium translate limit with its throttle threshold", async () => {
    stubPreflight({ allowed: true, tier_active: "PREMIUM" });

    await checkPreflight(mockEnv(), "uid-5", "PREMIUM", "translate", null);

    const preflightCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    const chunks = executeQueryChunks(preflightCall![0]);
    expect(chunks[3]).toBe("translate");
    expect(chunks[11]).toBe(0); // premiumDailyLimit (unlimited)
    expect(chunks[13]).toBe(500); // premiumThrottleThreshold
    expect(chunks[7]).toBe(25); // freeDailyLimit
    expect(chunks[15]).toBe(3); // throttleCooldownSeconds
  });

  test("sends the premium speech char limit and this request's charge for a speech gate", async () => {
    stubPreflight({ allowed: true, tier_active: "PREMIUM" });

    await checkPreflight(mockEnv(), "uid-tts", "PREMIUM", "speech", null, 42);

    const preflightCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    const chunks = executeQueryChunks(preflightCall![0]);
    expect(chunks[3]).toBe("speech");
    expect(chunks[7]).toBe(getLimits("FREE").dailySpeechCharsLimit);
    expect(chunks[17]).toBe(getLimits("PREMIUM").dailySpeechCharsLimit);
    expect(chunks[19]).toBe(42);
    expect(chunks[13]).toBe(0); // premiumThrottleThreshold for speech
  });

  test("sends a zero char charge for non-speech usage types", async () => {
    stubPreflight({ allowed: true, tier_active: "FREE" });

    await checkPreflight(mockEnv(), "uid-free", "FREE", "translate", null);

    const preflightCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    const chunks = executeQueryChunks(preflightCall![0]);
    expect(chunks[3]).toBe("translate");
    expect(chunks[19]).toBe(0); // chargeChars
  });

  test("fails closed to PREFLIGHT_UNAVAILABLE when the RPC returns an error", async () => {
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        throw new Error("boom");
      }
      return [];
    });

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
      mockEnv({ HYPERDRIVE: undefined }),
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
    stubPreflight(
      { allowed: true, tier_active: "FREE" },
      { sessionActive: false },
    );

    const res = await checkPreflight(
      mockEnv(),
      "uid-6",
      "FREE",
      "translate",
      "session-abc",
    );

    // Verify the session check received the session ID
    const sessionCall = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_session_active"),
    );
    expect(sessionCall).toBeDefined();
    expect(executeQueryChunks(sessionCall![0])[1]).toBe("session-abc");

    expect(res).toMatchObject({
      allowed: false,
      tier_active: "FREE",
      reason: "SESSION_INACTIVE",
    });
  });

  test("fails open when the session-active RPC errors, still gating on quota", async () => {
    let preflightCalls = 0;
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_session_active")) {
        throw new Error("boom");
      }
      if (q.includes("check_preflight")) {
        preflightCalls += 1;
        return [{ preflight: { allowed: true, tier_active: "FREE" } }];
      }
      return [];
    });

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
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        calls += 1;
        return [
          {
            preflight: {
              allowed: true,
              tier_active: "FREE",
              quota_total: 25,
              quota_remaining: 24,
            },
          },
        ];
      }
      return [];
    });
    return () => calls;
  }

  test("checks the quota on every request and never reads or writes KV", async () => {
    const env = mockEnv();
    const calls = rpcSpy();
    const getSpy = vi.spyOn(env.EKWE_KV, "get");
    const putSpy = vi.spyOn(env.EKWE_KV, "put");

    const first = await runPreflightGate(
      env,
      ctx,
      "uid-g1",
      "FREE",
      "translate",
      null,
    );
    expect(first.ok).toBe(true);
    expect(calls()).toBe(1);

    const second = await runPreflightGate(
      env,
      ctx,
      "uid-g1",
      "FREE",
      "translate",
      null,
    );
    expect(second.ok).toBe(true);
    // Authoritative every time — the cooldown and quota are enforced in SQL.
    expect(calls()).toBe(2);
    expect(getSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  test("never admits a request using another request's quota decision", async () => {
    const env = mockEnv();
    const ctxLocal = mockExecutionContext();
    const chargeChars: number[] = [];
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        const chunks = executeQueryChunks(query);
        const charge = chunks[19] as number; // chargeChars position
        chargeChars.push(charge);
        return [
          {
            preflight: {
              allowed: charge <= 100,
              tier_active: "FREE",
              reason: charge <= 100 ? undefined : "QUOTA_EXCEEDED",
              quota_total: 100,
              quota_remaining: charge <= 100 ? 50 : 0,
            },
          },
        ];
      }
      return [];
    });

    const small = await runPreflightGate(
      env,
      ctxLocal,
      "uid-charge",
      "FREE",
      "speech",
      null,
      50,
    );
    expect(small.ok).toBe(true);

    const large = await runPreflightGate(
      env,
      ctxLocal,
      "uid-charge",
      "FREE",
      "speech",
      null,
      900,
    );
    expect(large.ok).toBe(false);
    if (!large.ok) {
      expect(large.response.status).toBe(429);
    }
    expect(chargeChars).toEqual([50, 900]);
  });

  test("returns a 429 EKWE_QUOTA_EXCEEDED response when the quota is exhausted", async () => {
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        return [
          {
            preflight: {
              allowed: false,
              reason: "QUOTA_EXCEEDED",
              quota_total: 25,
              quota_remaining: 0,
            },
          },
        ];
      }
      return [];
    });

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
      const body = await jsonBody(gate.response);
      expect(body).toMatchObject({
        error: "EKWE_QUOTA_EXCEEDED",
        quota_total: 25,
        quota_remaining: 0,
      });
    }
  });

  test("returns a 429 EKWE_RATE_LIMIT response with the remaining cooldown", async () => {
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        return [
          {
            preflight: {
              allowed: false,
              reason: "RATE_LIMIT",
              cooldown_remaining: 12.4,
            },
          },
        ];
      }
      return [];
    });

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
      const body = await jsonBody(gate.response);
      expect(body).toMatchObject({ error: "EKWE_RATE_LIMIT" });
    }
  });

  test("passes through a throttled PREMIUM response without blocking", async () => {
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_preflight")) {
        return [
          {
            preflight: {
              allowed: true,
              tier_active: "PREMIUM",
              throttled: true,
              quota_total: 0,
              quota_remaining: 0,
            },
          },
        ];
      }
      return [];
    });

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
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_session_active")) {
        return [{ active: false }];
      }
      if (q.includes("check_preflight")) {
        return [{ preflight: { allowed: true, tier_active: "FREE" } }];
      }
      return [];
    });

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
      const body = await jsonBody(gate.response);
      expect(body).toMatchObject({ error: "UNAUTHORIZED" });
    }
  });

  test("issues the session and quota checks concurrently", async () => {
    // Both are independent reads in front of every billable request, so they
    // must not serialise into two round trips.
    const order: string[] = [];
    let releaseQuota: (() => void) | null = null;
    const quotaBlocked = new Promise<void>((resolve) => {
      releaseQuota = resolve;
    });

    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_session_active")) {
        order.push("session:start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("session:end");
        return [{ active: true }];
      }
      if (q.includes("check_preflight")) {
        order.push("quota:start");
        await quotaBlocked;
        order.push("quota:end");
        return [{ preflight: { allowed: true, tier_active: "FREE" } }];
      }
      return [];
    });

    const env = mockEnv();
    const ctxLocal = mockExecutionContext();

    const gate = runPreflightGate(
      env,
      ctxLocal,
      "uid-c",
      "FREE",
      "speech",
      "sess-1",
    );

    // Let the session call get going, then confirm the quota call started
    // before the session call finished.
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toContain("session:start");
    expect(order).toContain("quota:start");
    expect(order).not.toContain("session:end");

    releaseQuota!();
    const result = await gate;
    expect(result.ok).toBe(true);
    expect(order.indexOf("quota:start")).toBeLessThan(
      order.indexOf("session:end"),
    );
  });

  test("still denies on an inactive session even though the quota check ran", async () => {
    mockDb.execute.mockImplementation(async (query) => {
      const q = JSON.stringify(query);
      if (q.includes("check_session_active")) {
        return [{ active: false }];
      }
      if (q.includes("check_preflight")) {
        return [{ preflight: { allowed: true, tier_active: "PREMIUM" } }];
      }
      return [];
    });

    const env = mockEnv();
    const ctxLocal = mockExecutionContext();

    const gate = await runPreflightGate(
      env,
      ctxLocal,
      "uid-d",
      "PREMIUM",
      "speech",
      "sess-dead",
    );

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(401);
    }
  });
});

describe("check_preflight row shape", () => {
  // Regression: the deployed worker answered EVERY billable request with 429
  // "Please wait 0 seconds." between Oct 5 and Oct 6. `SELECT * FROM
  // check_preflight(...)` returns one column named after the function, so
  // `result[0].allowed` was undefined, the deny branch ran, and `reason` was
  // undefined too — which the catch-all reported as a rate limit. Pin both the
  // SQL alias and the unwrap so the shape cannot silently change again.
  beforeEach(() => {
    mockDb.execute.mockReset();
    mockDb.execute.mockResolvedValue([]);
  });

  test("aliases the function so the driver row is { preflight }", async () => {
    stubPreflight({ allowed: true, tier_active: "FREE" });
    await checkPreflight(mockEnv(), "uid-shape", "FREE", "translate", null);
    const call = mockDb.execute.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes("check_preflight"),
    );
    expect(JSON.stringify(call?.[0])).toContain("AS preflight");
  });

  test("reads allowed/reason through the preflight wrapper", async () => {
    stubPreflight({ allowed: true, tier_active: "FREE", quota_remaining: 25 });
    const res = await checkPreflight(
      mockEnv(),
      "uid-shape",
      "FREE",
      "translate",
      null,
    );
    expect(res.allowed).toBe(true);
    expect(res.quota_remaining).toBe(25);
  });

  test("a genuine RATE_LIMIT still yields 429 with a positive Retry-After", async () => {
    stubPreflight({
      allowed: false,
      reason: "RATE_LIMIT",
      cooldown_remaining: 2.4,
    });
    const gate = await runPreflightGate(
      mockEnv(),
      mockExecutionContext(),
      "uid-shape",
      "FREE",
      "translate",
      null,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(429);
      expect(gate.response.headers.get("Retry-After")).toBe("3");
    }
  });

  test("an unrecognised reason is a 500, never a rate limit", async () => {
    stubPreflight({ allowed: false });
    const gate = await runPreflightGate(
      mockEnv(),
      mockExecutionContext(),
      "uid-shape",
      "FREE",
      "translate",
      null,
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(500);
      expect(gate.response.headers.get("Retry-After")).toBeNull();
    }
  });
});
