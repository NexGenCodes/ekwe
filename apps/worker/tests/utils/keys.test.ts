import { describe, test, expect, vi } from "vitest";
import { sanitizeKey } from "../../src/utils/keys";
import { mockEnv, jsonResponse } from "../setup";

// ─── sanitizeKey ───────────────────────────────────────────────────

describe("sanitizeKey", () => {
  test("passes valid key through", () => {
    expect(sanitizeKey("valid-key-123")).toBe("valid-key-123");
  });

  test("strips non-printable chars", () => {
    expect(sanitizeKey("key\x00null")).toBe("keynull");
  });

  test("returns empty for empty string", () => {
    expect(sanitizeKey("")).toBe("");
  });

  test("returns empty for null", () => {
    expect(sanitizeKey(null)).toBe("");
  });

  test("returns empty for non-string", () => {
    expect(sanitizeKey(123)).toBe("");
  });

  test("trims whitespace", () => {
    expect(sanitizeKey("  key-123  ")).toBe("key-123");
  });
});

// ─── getRandomInt ─────────────────────────────────────────────────

describe("getRandomInt", () => {
  test("returns a value in [0, max)", async () => {
    const { getRandomInt } = await import("../../src/utils/keys");
    for (let i = 0; i < 100; i++) {
      const value = getRandomInt(100);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(100);
    }
  });

  test("does not loop forever for max <= 0", async () => {
    const { getRandomInt } = await import("../../src/utils/keys");
    expect(getRandomInt(0)).toBeNaN();
    expect(getRandomInt(-5)).toBeNaN();
    expect(getRandomInt(1.5)).toBeNaN();
    expect(getRandomInt(NaN)).toBeNaN();
  });
});

// ─── rotateKeys (integration with mock) ────────────────────────────

describe("rotateKeys", () => {
  test("returns first 2xx response", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "valid-key-1-abcde",
      GROQ_KEY_2: "valid-key-2-abcde",
    });

    let callCount = 0;
    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => {
        callCount++;
        return jsonResponse({ ok: true });
      },
      new AbortController().signal,
    );

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(callCount).toBe(1);
  });

  test("skips blacklisted keys", async () => {
    const { rotateKeys, hashKey } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "blacklisted-key-abc",
      GROQ_KEY_2: "valid-key-2-abcde",
    });

    const hash1 = await hashKey("blacklisted-key-abc");
    await env.EKWE_KV.put(`blacklist:groq_key:${hash1}`, "true", {
      expirationTtl: 60,
    });

    let blacklistKeyAttempted = false;
    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async (key) => {
        if (key === "blacklisted-key-abc") blacklistKeyAttempted = true;
        return jsonResponse({ ok: true });
      },
      new AbortController().signal,
    );

    expect(blacklistKeyAttempted).toBe(false);
    expect(result).not.toBeNull();
  });

  test("blacklists 429 keys", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "rate-limited-key-abc",
    });

    await rotateKeys(
      env,
      "GROQ_KEY_",
      async (_key) => {
        return jsonResponse({}, 429);
      },
      new AbortController().signal,
    );

    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      expect.stringContaining("blacklist:groq_key:"),
      "true",
      expect.objectContaining({ expirationTtl: 60 }),
    );
  });

  test("blacklists 401 keys with a 24h TTL", async () => {
    const { rotateKeys, hashKey } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "unauthorized-key-abc",
    });

    await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => jsonResponse({}, 401),
      new AbortController().signal,
    );

    const hash = await hashKey("unauthorized-key-abc");
    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      `blacklist:groq_key:${hash}`,
      "true",
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  test("blacklists 402 keys with a 24h TTL", async () => {
    const { rotateKeys, hashKey } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "payment-required-key",
    });

    await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => jsonResponse({}, 402),
      new AbortController().signal,
    );

    const hash = await hashKey("payment-required-key");
    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      `blacklist:groq_key:${hash}`,
      "true",
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  test("blacklists 403 keys with a 24h TTL", async () => {
    const { rotateKeys, hashKey } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "forbidden-key-abc",
    });

    await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => jsonResponse({}, 403),
      new AbortController().signal,
    );

    const hash = await hashKey("forbidden-key-abc");
    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      `blacklist:groq_key:${hash}`,
      "true",
      expect.objectContaining({ expirationTtl: 86400 }),
    );
  });

  test("does not blacklist other 4xx statuses", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "bad-request-key",
    });

    await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => jsonResponse({}, 404),
      new AbortController().signal,
    );

    expect(env.EKWE_KV.put).not.toHaveBeenCalled();
  });

  test("shuffles keys deterministically when the RNG is stubbed", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "healthy-key-abcde",
      GROQ_KEY_2: "sick-key-abcde",
    });

    const getRandomValues = vi.spyOn(crypto, "getRandomValues");
    getRandomValues.mockImplementation((arr) => {
      if (arr instanceof Uint32Array) {
        arr[0] = 1;
        arr[1] = 0;
      }
      return arr;
    });

    const attempts: string[] = [];
    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async (key) => {
        attempts.push(key);
        return jsonResponse({ ok: true });
      },
      new AbortController().signal,
    );

    expect(result).not.toBeNull();
    expect(attempts).toEqual(["sick-key-abcde"]);
    getRandomValues.mockRestore();
  });

  test("skips 4xx and 5xx errors", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "fail-key-1-abcde",
      GROQ_KEY_2: "valid-key-2-abcde",
    });

    let callCount = 0;
    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async (key) => {
        callCount++;
        if (key === "fail-key-1-abcde") return jsonResponse({}, 400);
        return jsonResponse({ ok: true });
      },
      new AbortController().signal,
    );

    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThanOrEqual(2);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  test("returns null when all keys fail", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "fail-key-1-abcde",
      GROQ_KEY_2: "fail-key-2-abcde",
    });

    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => jsonResponse({}, 500),
      new AbortController().signal,
    );
    expect(result).toBeNull();
  });

  test("fails fast on 5xx without trying remaining keys", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({
      GROQ_KEY_1: "fail-key-1-abcde",
      GROQ_KEY_2: "fail-key-2-abcde",
      GROQ_KEY_3: "fail-key-3-abcde",
    });

    let callCount = 0;
    const result = await rotateKeys(
      env,
      "GROQ_KEY_",
      async () => {
        callCount++;
        return jsonResponse({}, 502);
      },
      new AbortController().signal,
    );

    expect(result).toBeNull();
    expect(callCount).toBe(1);
  });

  test("throws on abort", async () => {
    const { rotateKeys } = await import("../../src/utils/keys");
    const env = mockEnv({ GROQ_KEY_1: "valid-key-1-abcde" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      rotateKeys(
        env,
        "GROQ_KEY_",
        async () => jsonResponse({}),
        controller.signal,
      ),
    ).rejects.toThrow("CLIENT_ABORTED");
  });
});
