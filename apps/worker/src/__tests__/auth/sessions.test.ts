import { beforeEach, describe, expect, test } from "vitest";
import type { Env } from "@/core/types";
import { createSession, revokeSession, rotateSession } from "@/auth/sessions";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function makeEnv(database: TestDatabase): Env {
  return { DB: database.d1 } as unknown as Env;
}

function seedUser(database: TestDatabase): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, tier, created_at, updated_at)
       VALUES (?, ?, ?, 'FREE', ?, ?)`,
    )
    .run(USER_ID, "user@test.dev", "user@test.dev", now, now);
}

describe("sessions", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    database = createTestDatabase();
    env = makeEnv(database);
    seedUser(database);
  });

  test("creates a session with a single rotation row", async () => {
    const session = await createSession(env, USER_ID, "vitest");

    const rotations = database.sqlite
      .prepare(`SELECT refresh_hash, replaced_by FROM session_rotations`)
      .all();
    expect(rotations).toHaveLength(1);
    expect(rotations[0]?.replaced_by).toBeNull();
    expect(session.refreshExpiresAt).toBeGreaterThan(Date.now());
  });

  test("rotates to a new token and links the chain", async () => {
    const first = await createSession(env, USER_ID, "vitest");
    const second = await rotateSession(env, first.refreshToken);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const consumed = database.sqlite
      .prepare(
        `SELECT replaced_by, used_at FROM session_rotations WHERE session_id = ?`,
      )
      .all(second.sessionId) as {
      replaced_by: string | null;
      used_at: number | null;
    }[];

    expect(consumed).toHaveLength(2);
    expect(consumed.filter((row) => row.replaced_by !== null)).toHaveLength(1);
  });

  test("rejects a replay and revokes the family", async () => {
    const first = await createSession(env, USER_ID, "vitest");
    const second = await rotateSession(env, first.refreshToken);
    if (!second.ok) throw new Error("rotation failed");

    const replay = await rotateSession(env, first.refreshToken);
    expect(replay).toMatchObject({ ok: false, reason: "reuse" });

    const afterRevoke = await rotateSession(env, second.refreshToken);
    expect(afterRevoke).toMatchObject({ ok: false, reason: "expired" });
  });

  test("lets exactly one of two concurrent refreshes win", async () => {
    const first = await createSession(env, USER_ID, "vitest");

    const results = await Promise.all([
      rotateSession(env, first.refreshToken),
      rotateSession(env, first.refreshToken),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.reason === "reuse"),
    ).toHaveLength(1);
  });

  test("rejects unknown tokens", async () => {
    const result = await rotateSession(env, "not-a-real-token");
    expect(result).toMatchObject({ ok: false, reason: "unknown" });
  });

  test("rejects revoked sessions", async () => {
    const session = await createSession(env, USER_ID, "vitest");
    await revokeSession(env, session.sessionId);

    const result = await rotateSession(env, session.refreshToken);
    expect(result).toMatchObject({ ok: false, reason: "expired" });
  });
});
