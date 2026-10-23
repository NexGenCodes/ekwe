import { describe, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import type { Env } from "@/core/types";
import { authenticate, isAdminAuthorized } from "@/core/auth";
import { mintAccessToken } from "@/auth/jwt";

async function makeEnv(): Promise<Env> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });

  return {
    JWT_ISSUER: "https://ekwe.test",
    JWT_PRIVATE_JWK: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_JWK: JSON.stringify(await exportJWK(publicKey)),
  } as unknown as Env;
}

const CLAIMS = {
  userId: "user-123",
  email: "user@example.com",
  sessionId: "session-abc",
  isPro: false,
};

describe("authenticate()", () => {
  test("round-trips a FREE token", async () => {
    const env = await makeEnv();
    const { token } = await mintAccessToken(env, CLAIMS);

    const result = await authenticate(token, env);
    expect(result).toEqual({
      userId: "user-123",
      userEmail: "user@example.com",
      tier: "FREE",
      sessionId: "session-abc",
    });
  });

  test("maps is_pro to the PREMIUM tier", async () => {
    const env = await makeEnv();
    const { token } = await mintAccessToken(env, { ...CLAIMS, isPro: true });

    const result = await authenticate(token, env);
    expect(result?.tier).toBe("PREMIUM");
  });

  test("rejects a token signed by a different key", async () => {
    const env = await makeEnv();
    const other = await makeEnv();
    const { token } = await mintAccessToken(other, CLAIMS);

    expect(await authenticate(token, env)).toBeNull();
  });

  test("rejects a token from another issuer", async () => {
    const env = await makeEnv();
    const { token } = await mintAccessToken(
      { ...env, JWT_ISSUER: "https://attacker.test" } as unknown as Env,
      CLAIMS,
    );

    expect(await authenticate(token, env)).toBeNull();
  });

  test("rejects an expired token", async () => {
    const env = await makeEnv();
    const { token } = await mintAccessToken(env, CLAIMS);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
      expect(await authenticate(token, env)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects malformed input", async () => {
    const env = await makeEnv();
    expect(await authenticate("not-a-jwt", env)).toBeNull();
  });
});

describe("isAdminAuthorized()", () => {
  const env = { UPDATE_NOTIFY_SECRET: "s3cret" } as unknown as Env;

  test("accepts the configured bearer token", async () => {
    const request = new Request("https://ekwe.test/admin", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(await isAdminAuthorized(env, request)).toBe(true);
  });

  test("rejects a wrong or missing token", async () => {
    expect(
      await isAdminAuthorized(
        env,
        new Request("https://ekwe.test/admin", {
          headers: { Authorization: "Bearer nope" },
        }),
      ),
    ).toBe(false);

    expect(
      await isAdminAuthorized(env, new Request("https://ekwe.test/admin")),
    ).toBe(false);
  });

  test("rejects everything when no secret is configured", async () => {
    const request = new Request("https://ekwe.test/admin", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(await isAdminAuthorized({} as Env, request)).toBe(false);
  });
});
