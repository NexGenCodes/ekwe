import { describe, expect, it, vi, beforeEach } from "vitest";

const bodies: Array<Record<string, unknown>> = [];

vi.mock("@/services/supabase", () => ({
  supabaseServiceHeaders: () => ({}),
  supabasePost: vi.fn(async (_env: unknown, _path: string, body: unknown) => {
    bodies.push(body as Record<string, unknown>);
    return {
      ok: true,
      json: async () => ({
        allowed: true,
        tier_active: "FREE",
        reason: null,
        cooldown_remaining: 0,
        quota_total: null,
        quota_remaining: null,
        throttled: false,
      }),
    };
  }),
}));

import { checkPreflight } from "@/services/preflight";

const env = {} as Env;

function cooldown(type: string, skip: boolean): number {
  void checkPreflight(env, "u1", "FREE", type as never, null, 0, skip).catch(
    () => undefined,
  );
  return bodies[bodies.length - 1].p_free_cooldown_seconds as number;
}

describe("checkPreflight cooldown scoping", () => {
  beforeEach(() => {
    bodies.length = 0;
    vi.clearAllMocks();
  });

  it("charges the cooldown on the first gate of a request", () => {
    expect(cooldown("transcribe", false)).toBeGreaterThan(0);
  });

  it("sends no cooldown when the request already charged", () => {
    expect(cooldown("speech", true)).toBe(0);
  });

  it("still charges speech quota when the cooldown is skipped", async () => {
    bodies.length = 0;
    await checkPreflight(env, "u1", "FREE", "speech", null, 120, true);
    const body = bodies[bodies.length - 1];
    expect(body.p_charge_chars).toBe(120);
    expect(body.p_free_daily_limit).toBeGreaterThan(0);
  });

  it("still charges translate quota when the cooldown is skipped", async () => {
    bodies.length = 0;
    await checkPreflight(env, "u1", "FREE", "translate", null, 0, true);
    expect(bodies[bodies.length - 1].p_free_daily_limit).toBe(25);
  });

  it("applies the same rule to the premium cooldown", () => {
    void checkPreflight(env, "u1", "PREMIUM", "speech", null, 0, true).catch(
      () => undefined,
    );
    expect(bodies[bodies.length - 1].p_premium_cooldown_seconds).toBe(0);
  });

  it("does not zero the throttle cooldown for a charged request", () => {
    void checkPreflight(env, "u1", "PREMIUM", "speech", null, 0, true).catch(
      () => undefined,
    );
    expect(bodies[bodies.length - 1].p_throttle_cooldown_seconds).toBe(3);
  });
});
