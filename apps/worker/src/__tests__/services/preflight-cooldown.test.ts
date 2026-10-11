import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockDb, mockEnv, executeQueryChunks } from "@/__tests__/setup";
import { checkPreflight } from "@/services/preflight";
import { getLimits } from "@/core/limits";

const env = mockEnv();

/**
 * Helper to call checkPreflight and return the queryChunks from the
 * check_preflight RPC call for parameter inspection.
 */
async function preflightChunks(
  type: string,
  skip: boolean,
  chargeChars = 0,
  tier: "FREE" | "PREMIUM" = "FREE",
): Promise<unknown[]> {
  mockDb.execute.mockImplementation(async (query) => {
    const q = JSON.stringify(query);
    if (q.includes("check_preflight")) {
      return [
        {
          preflight: {
            allowed: true,
            tier_active: tier,
            reason: null,
            cooldown_remaining: 0,
            quota_total: null,
            quota_remaining: null,
            throttled: false,
          },
        },
      ];
    }
    return [];
  });

  await checkPreflight(env, "u1", tier, type as never, null, chargeChars, skip);

  const call = mockDb.execute.mock.calls.find((c) =>
    JSON.stringify(c[0]).includes("check_preflight"),
  );
  return executeQueryChunks(call![0]);
}

describe("checkPreflight cooldown scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("charges the cooldown on the first gate of a request", async () => {
    const chunks = await preflightChunks("transcribe", false);
    // chunks[5] = freeCooldownSeconds
    expect(chunks[5]).toBeGreaterThan(0);
  });

  it("sends no cooldown when the request already charged", async () => {
    const chunks = await preflightChunks("speech", true);
    // chunks[5] = freeCooldownSeconds (should be 0 when skipCooldown is true)
    expect(chunks[5]).toBe(0);
  });

  it("still charges speech quota when the cooldown is skipped", async () => {
    const chunks = await preflightChunks("speech", true, 120);
    // chunks[19] = chargeChars
    expect(chunks[19]).toBe(120);
    // chunks[7] = freeDailyLimit
    expect(chunks[7]).toBeGreaterThan(0);
  });

  it("still charges translate quota when the cooldown is skipped", async () => {
    const chunks = await preflightChunks("translate", true);
    // chunks[7] = freeDailyLimit
    expect(chunks[7]).toBe(25);
  });

  it("applies the same rule to the premium cooldown", async () => {
    const chunks = await preflightChunks("speech", true, 0, "PREMIUM");
    // chunks[9] = premiumCooldownSeconds (should be 0 when skipCooldown is true)
    expect(chunks[9]).toBe(0);
  });

  it("does not zero the throttle cooldown for a charged request", async () => {
    const chunks = await preflightChunks("speech", true, 0, "PREMIUM");
    // chunks[15] = throttleCooldownSeconds (should NOT be zeroed by skipCooldown)
    expect(chunks[15]).toBe(getLimits("FREE").cooldownSeconds);
  });
});
