import { beforeEach, describe, expect, test, vi } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import { app } from "@/app";
import type { Env } from "@/core/types";
import { mockEnv, mockExecutionContext } from "@/__tests__/setup";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const { sendOtpEmail } = vi.hoisted(() => ({
  sendOtpEmail: vi.fn(async () => true),
}));

vi.mock("@/services/email", () => ({ sendOtpEmail }));

interface SessionPayload {
  user: { id: string; email: string; tier: string; avatarIcon: string | null };
  accessToken: string;
  refreshToken: string;
}

function request(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  return new Request(`http://test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function lastCode(): string {
  const calls = sendOtpEmail.mock.calls;
  return (calls[calls.length - 1] as unknown as [Env, string, string])[2];
}

describe("auth flow", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(async () => {
    database = createTestDatabase();
    sendOtpEmail.mockClear();

    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });

    env = mockEnv({
      DB: database.d1,
      JWT_ISSUER: "https://ekwe.test",
      JWT_PRIVATE_JWK: JSON.stringify(await exportJWK(privateKey)),
      JWT_PUBLIC_JWK: JSON.stringify(await exportJWK(publicKey)),
      OTP_PEPPER: "test-pepper",
    } as unknown as Partial<Env>);
  });

  async function signIn(email: string): Promise<SessionPayload> {
    const sent = await app.fetch(
      request("/auth/otp", "POST", { email }),
      env,
      mockExecutionContext(),
    );
    expect(sent.status).toBe(200);

    const verified = await app.fetch(
      request("/auth/verify", "POST", { email, code: lastCode() }),
      env,
      mockExecutionContext(),
    );
    expect(verified.status).toBe(200);
    return (await verified.json()) as SessionPayload;
  }

  test("signs in with an emailed code", async () => {
    const session = await signIn("person@test.dev");

    expect(session.user.email).toBe("person@test.dev");
    expect(session.user.tier).toBe("FREE");
    expect(session.accessToken.split(".")).toHaveLength(3);
    expect(session.refreshToken.length).toBeGreaterThan(20);
  });

  test("rejects a wrong code", async () => {
    await app.fetch(
      request("/auth/otp", "POST", { email: "person@test.dev" }),
      env,
      mockExecutionContext(),
    );

    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const res = await app.fetch(
      request("/auth/verify", "POST", {
        email: "person@test.dev",
        code: wrong,
      }),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_CODE" });
  });

  test("returns the current user for a valid access token", async () => {
    const session = await signIn("person@test.dev");

    const res = await app.fetch(
      request("/auth/session", "GET", undefined, session.accessToken),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { id: session.user.id, email: "person@test.dev" },
    });
  });

  test("rotates the refresh token and keeps the session", async () => {
    const session = await signIn("person@test.dev");

    const res = await app.fetch(
      request("/auth/refresh", "POST", {
        refreshToken: session.refreshToken,
      }),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    const rotated = (await res.json()) as SessionPayload;
    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    expect(rotated.user.id).toBe(session.user.id);
  });

  test("updates the avatar icon", async () => {
    const session = await signIn("person@test.dev");

    const res = await app.fetch(
      request(
        "/auth/profile",
        "PATCH",
        { avatarIcon: "star" },
        session.accessToken,
      ),
      env,
      mockExecutionContext(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { avatarIcon: "star" },
    });
  });

  test("hard-deletes the account and its session", async () => {
    const session = await signIn("person@test.dev");

    const res = await app.fetch(
      request("/auth/account", "DELETE", undefined, session.accessToken),
      env,
      mockExecutionContext(),
    );
    expect(res.status).toBe(204);

    const users = database.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM users`)
      .get() as {
      n: number;
    };
    const sessions = database.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM sessions`)
      .get() as { n: number };

    expect(users.n).toBe(0);
    expect(sessions.n).toBe(0);

    const refreshed = await app.fetch(
      request("/auth/refresh", "POST", {
        refreshToken: session.refreshToken,
      }),
      env,
      mockExecutionContext(),
    );
    expect(refreshed.status).toBe(401);
  });
});
