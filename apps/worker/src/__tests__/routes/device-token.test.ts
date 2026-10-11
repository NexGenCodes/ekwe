import { describe, test, expect, beforeEach, vi } from "vitest";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import type { AuthResult } from "@/core/auth";
import { mockDb, mockEnv } from "@/__tests__/setup";
import { PgDialect } from "drizzle-orm/pg-core";

const auth = (userId: string): AuthResult => ({
  userId,
  userEmail: "a@b.c",
  tier: "FREE",
  sessionId: null,
});

type ConflictArg = {
  target: unknown;
  set: Record<string, unknown>;
};

function conflictArg(): ConflictArg {
  const call = mockDb.onConflictDoUpdate.mock.calls[0];
  expect(call, "onConflictDoUpdate was never called").toBeDefined();
  return call[0] as ConflictArg;
}

/** Renders a Drizzle `sql` fragment the way the pg driver would. */
function sqlText(value: unknown): string {
  return new PgDialect().sqlToQuery(value as never).sql;
}

describe("handleRegisterDeviceToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("registers an anonymous token with no owner", async () => {
    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      mockEnv(),
      null,
    );

    expect(res.status).toBe(200);
    const values = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    expect(values.userId).toBeNull();
  });

  test("a conflict never clears or reassigns an existing owner", async () => {
    await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      mockEnv(),
      null,
    );

    const { set } = conflictArg();

    // The owner column must be a conditional expression, not a literal that
    // would overwrite whatever the row already records.
    expect(sqlText(set.userId)).toMatch(/COALESCE/i);

    // Nothing else in the conflict clause may reintroduce a plain owner write.
    for (const [key, value] of Object.entries(set)) {
      if (key === "userId") continue;
      expect(
        (value as Record<string, unknown>)?.userId,
        `set.${key} must not carry userId`,
      ).toBeUndefined();
    }
  });

  test("an authenticated call still records its own user id on insert", async () => {
    const userId = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";

    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[xyz]", platform: "ios" },
      mockEnv(),
      auth(userId),
    );

    expect(res.status).toBe(200);
    const values = mockDb.values.mock.calls[0][0] as Record<string, unknown>;
    expect(values.userId).toBe(userId);
    expect(sqlText(conflictArg().set.userId)).toMatch(/COALESCE/i);
  });

  test("a db failure surfaces as a 502, not a 500", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("boom") as never);
    mockDb.insert.mockImplementationOnce((() => {
      throw new Error("connection lost");
    }) as never);

    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      mockEnv(),
      null,
    );

    expect(res.status).toBe(502);
  });
});
