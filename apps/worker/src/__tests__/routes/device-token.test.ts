import { beforeEach, describe, expect, test } from "vitest";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import type { AuthResult } from "@/core/auth";
import type { Env } from "@/core/types";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const OTHER_USER_ID = "4a8d2e3f-6c7b-4d9e-8f01-2b3c4d5e6f70";

const auth = (userId: string): AuthResult => ({
  userId,
  userEmail: "a@b.c",
  tier: "FREE",
  sessionId: null,
});

function makeEnv(database: TestDatabase): Env {
  return { DB: database.d1, APP_ENV: "test" } as unknown as Env;
}

function seedUser(database: TestDatabase, id: string): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, `${id}@test.dev`, `${id}@test.dev`, now, now);
}

function stored(database: TestDatabase, token: string) {
  return database.sqlite
    .prepare(
      `SELECT user_id, platform, app_version, is_active
         FROM push_tokens WHERE push_token = ?`,
    )
    .get(token) as
    | {
        user_id: string | null;
        platform: string;
        app_version: string | null;
        is_active: number;
      }
    | undefined;
}

describe("handleRegisterDeviceToken", () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
    seedUser(database, USER_ID);
    seedUser(database, OTHER_USER_ID);
  });

  test("binds a token to the authenticated user", async () => {
    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      makeEnv(database),
      auth(USER_ID),
    );

    expect(res.status).toBe(200);
    expect(stored(database, "ExponentPushToken[abc]")).toMatchObject({
      user_id: USER_ID,
      platform: "android",
      is_active: 1,
    });
  });

  test("a re-registration updates the device and keeps the owner", async () => {
    const env = makeEnv(database);
    await handleRegisterDeviceToken(
      {
        push_token: "ExponentPushToken[abc]",
        platform: "android",
        app_version: "1.0.0",
      },
      env,
      auth(USER_ID),
    );
    await handleRegisterDeviceToken(
      {
        push_token: "ExponentPushToken[abc]",
        platform: "ios",
        app_version: "1.1.0",
      },
      env,
      auth(USER_ID),
    );

    expect(stored(database, "ExponentPushToken[abc]")).toMatchObject({
      user_id: USER_ID,
      platform: "ios",
      app_version: "1.1.0",
    });
  });

  test("another account cannot take over an owned token", async () => {
    const env = makeEnv(database);
    await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      env,
      auth(USER_ID),
    );

    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "ios" },
      env,
      auth(OTHER_USER_ID),
    );

    expect(res.status).toBe(200);
    expect(stored(database, "ExponentPushToken[abc]")?.user_id).toBe(USER_ID);
  });

  test("a database failure surfaces as a 502", async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error("boom");
        },
      },
    } as unknown as Env;

    const res = await handleRegisterDeviceToken(
      { push_token: "ExponentPushToken[abc]", platform: "android" },
      env,
      auth(USER_ID),
    );

    expect(res.status).toBe(502);
  });
});
