import { beforeEach, describe, expect, test } from "vitest";
import {
  d1Cleanup,
  d1Get,
  d1GetLang,
  d1Put,
  d1PutLang,
} from "@/services/d1-cache";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

describe("d1 cache", () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  test("stores translation expiry in epoch milliseconds", async () => {
    const before = Date.now();
    await d1Put(
      database.d1,
      "cache_translation",
      "key-1",
      "user-1",
      "free",
      "result",
      60,
    );

    const row = database.sqlite
      .prepare(
        "SELECT created_at, expires_at FROM cache_translation WHERE cache_key = ?",
      )
      .get("key-1") as { created_at: number; expires_at: number };

    expect(row.created_at).toBeGreaterThanOrEqual(before);
    expect(row.expires_at - row.created_at).toBe(60_000);
    await expect(
      d1Get(database.d1, "cache_translation", "key-1"),
    ).resolves.toBe("result");
  });

  test("treats an expired row as a miss and cleans it up", async () => {
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO cache_transcription
           (cache_key, user_id, tier, result, created_at, expires_at)
         VALUES (?, ?, 'free', ?, ?, ?)`,
      )
      .run("stale", "user-1", "old", now - 1_000, now - 1);

    await expect(
      d1Get(database.d1, "cache_transcription", "stale"),
    ).resolves.toBeNull();
    await expect(d1Cleanup(database.d1, "cache_transcription")).resolves.toBe(
      1,
    );
  });

  test("stores language detection expiry in epoch milliseconds", async () => {
    const before = Date.now();
    await d1PutLang(database.d1, "lang-key", "ig", 30);

    const row = database.sqlite
      .prepare("SELECT expires_at FROM cache_lang WHERE cache_key = ?")
      .get("lang-key") as { expires_at: number };
    expect(row.expires_at).toBeGreaterThanOrEqual(before + 29_000);
    await expect(d1GetLang(database.d1, "lang-key")).resolves.toBe("ig");
  });
});
