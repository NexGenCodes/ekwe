import { beforeEach, describe, expect, test } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "@/app";
import type { Env } from "@/core/types";
import type { HistoryRow } from "@ekwe/shared";
import { handlePull, handlePush } from "@/routes/sync";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

import { mockEnv } from "@/__tests__/setup";

function makeEnv(
  database: TestDatabase,
  extra: Record<string, string> = {},
): Env {
  return {
    ...mockEnv(),
    DB: database.d1,
    WORKERS_PAID: "false",
    SYNC_PUSH_COOLDOWN_MS: "0",
    ...extra,
  } as unknown as Env;
}

function makeRequest(env: Env) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      userId: USER_ID,
      userEmail: "user@test.dev",
      tier: "FREE",
      sessionId: null,
    });
    await next();
  });
  app.post("/pull", handlePull);
  app.post("/push", handlePush);

  return async (path: string, body: unknown): Promise<Response> =>
    app.request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
}

function makeRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "transcription",
    captureId: null,
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello world",
    translationText: null,
    transliterationText: null,
    duration: 1.5,
    sourceApp: "Ekwe",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: null,
    createdAt: 1_700_000_000_000,
    revision: 0,
    deletedAt: null,
    restore: false,
    ...overrides,
  };
}

function seedRow(
  database: TestDatabase,
  overrides: {
    id: string;
    userId?: string;
    updatedAt: number;
    revision?: number;
    deletedAt?: number | null;
  },
): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO history (
         id, user_id, type, capture_id, origin, input, source_lang, target_lang,
         transcript, translation_text, transliteration_text, duration,
         source_app, voice_id, stt_provider, mt_provider, created_at,
         updated_at, revision, deleted_at
       ) VALUES (?, ?, 'transcription', NULL, 'echo', 'audio', 'en', 'fr',
         'seeded', NULL, NULL, 0, '', NULL, '', NULL, ?, ?, ?, ?)`,
    )
    .run(
      overrides.id,
      overrides.userId ?? USER_ID,
      now,
      overrides.updatedAt,
      overrides.revision ?? 1,
      overrides.deletedAt ?? null,
    );
}

function stored(database: TestDatabase, id: string) {
  return database.sqlite
    .prepare(
      `SELECT user_id, transcript, translation_text, revision, deleted_at
         FROM history WHERE id = ?`,
    )
    .get(id) as
    | {
        user_id: string;
        transcript: string;
        translation_text: string | null;
        revision: number;
        deleted_at: number | null;
      }
    | undefined;
}

describe("POST /sync/pull", () => {
  let database: TestDatabase;
  let request: ReturnType<typeof makeRequest>;

  beforeEach(() => {
    database = createTestDatabase();
    request = makeRequest(makeEnv(database));
  });

  test("returns an empty page for a new account", async () => {
    const res = await request("/pull", {});
    expect(res.status).toBe(200);

    expect(await res.json()).toEqual({
      rows: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  test("returns the caller's rows in updated order, tombstones included", async () => {
    seedRow(database, { id: "row-bbbb", updatedAt: 2_000, revision: 4 });
    seedRow(database, { id: "row-aaaa", updatedAt: 1_000 });
    seedRow(database, {
      id: "row-cccc",
      updatedAt: 3_000,
      revision: 2,
      deletedAt: 2_900,
    });
    seedRow(database, {
      id: "row-xxxx",
      userId: OTHER_USER_ID,
      updatedAt: 4_000,
    });

    const body = (await (await request("/pull", {})).json()) as {
      rows: { id: string; revision: number; deletedAt: number | null }[];
      hasMore: boolean;
    };

    expect(body.rows.map((row) => row.id)).toEqual([
      "row-aaaa",
      "row-bbbb",
      "row-cccc",
    ]);
    expect(body.rows[1]?.revision).toBe(4);
    expect(body.rows[2]?.deletedAt).toBe(2_900);
    expect(body.hasMore).toBe(false);
  });

  test("pages with a (updatedAt, id) cursor", async () => {
    seedRow(database, { id: "row-aaaa", updatedAt: 1_000 });
    seedRow(database, { id: "row-bbbb", updatedAt: 2_000 });
    seedRow(database, { id: "row-cccc", updatedAt: 3_000 });

    const first = (await (await request("/pull", { limit: 2 })).json()) as {
      rows: { id: string }[];
      nextCursor: string;
      hasMore: boolean;
    };

    expect(first.rows.map((row) => row.id)).toEqual(["row-aaaa", "row-bbbb"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe("2000:row-bbbb");

    const second = (await (
      await request("/pull", { limit: 2, cursor: first.nextCursor })
    ).json()) as {
      rows: { id: string }[];
      nextCursor: string;
      hasMore: boolean;
    };

    expect(second.rows.map((row) => row.id)).toEqual(["row-cccc"]);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBe("3000:row-cccc");
  });

  test("rejects a malformed cursor", async () => {
    const res = await request("/pull", { cursor: "nonsense" });
    expect(res.status).toBe(400);
  });
});

describe("POST /sync/push", () => {
  let database: TestDatabase;
  let request: ReturnType<typeof makeRequest>;

  beforeEach(() => {
    database = createTestDatabase();
    request = makeRequest(makeEnv(database));
  });

  test("inserts a new row and issues revision 1", async () => {
    const res = await request("/push", {
      rows: [makeRow({ translationText: "bonjour" })],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { id: string; status: string; revision?: number }[];
    };
    expect(body.results).toEqual([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "ok",
        revision: 1,
      },
    ]);

    const row = stored(database, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(row?.user_id).toBe(USER_ID);
    expect(row?.translation_text).toBe("bonjour");
    expect(row?.revision).toBe(1);
  });

  test("updates a row whose base revision matches", async () => {
    seedRow(database, { id: "row-aaaa", updatedAt: 1_000, revision: 3 });

    const body = (await (
      await request("/push", {
        rows: [
          makeRow({
            id: "row-aaaa",
            transcript: "edited",
            translationText: "édité",
            revision: 3,
          }),
        ],
      })
    ).json()) as { results: { status: string; revision?: number }[] };

    expect(body.results[0]).toEqual({
      id: "row-aaaa",
      status: "ok",
      revision: 4,
    });
    expect(stored(database, "row-aaaa")?.translation_text).toBe("édité");
  });

  test("reports a conflict when the base revision is stale", async () => {
    seedRow(database, { id: "row-aaaa", updatedAt: 1_000, revision: 7 });

    const body = (await (
      await request("/push", {
        rows: [makeRow({ id: "row-aaaa", transcript: "clobber", revision: 2 })],
      })
    ).json()) as {
      results: {
        status: string;
        revision?: number;
        row?: { transcript: string; revision: number };
      }[];
    };

    expect(body.results[0]).toMatchObject({
      id: "row-aaaa",
      status: "conflict",
      revision: 7,
    });
    expect(body.results[0]?.row?.transcript).toBe("seeded");
    expect(body.results[0]?.row?.revision).toBe(7);
    expect(stored(database, "row-aaaa")?.transcript).toBe("seeded");
  });

  test("writes a tombstone and reports the delete", async () => {
    seedRow(database, { id: "row-aaaa", updatedAt: 1_000, revision: 2 });

    const body = (await (
      await request("/push", {
        rows: [
          makeRow({
            id: "row-aaaa",
            revision: 2,
            deletedAt: 1_700_000_000_500,
          }),
        ],
      })
    ).json()) as { results: { status: string; revision?: number }[] };

    expect(body.results[0]).toEqual({
      id: "row-aaaa",
      status: "ok",
      revision: 3,
    });
    expect(stored(database, "row-aaaa")?.deleted_at).toBe(1_700_000_000_500);
  });

  test("reports deleted when pushing to an existing tombstone", async () => {
    seedRow(database, {
      id: "row-aaaa",
      updatedAt: 1_000,
      revision: 2,
      deletedAt: 900,
    });

    const body = (await (
      await request("/push", {
        rows: [makeRow({ id: "row-aaaa", transcript: "late", revision: 2 })],
      })
    ).json()) as { results: { status: string; revision?: number }[] };

    expect(body.results[0]).toEqual({
      id: "row-aaaa",
      status: "deleted",
      revision: 2,
    });
    expect(stored(database, "row-aaaa")?.transcript).toBe("seeded");
  });

  test("restores a tombstone when explicitly requested", async () => {
    seedRow(database, {
      id: "row-aaaa",
      updatedAt: 1_000,
      revision: 5,
      deletedAt: 900,
    });

    const body = (await (
      await request("/push", {
        rows: [
          makeRow({
            id: "row-aaaa",
            transcript: "back",
            revision: 5,
            restore: true,
          }),
        ],
      })
    ).json()) as { results: { status: string; revision?: number }[] };

    expect(body.results[0]).toEqual({
      id: "row-aaaa",
      status: "ok",
      revision: 6,
    });
    const row = stored(database, "row-aaaa");
    expect(row?.deleted_at).toBeNull();
    expect(row?.transcript).toBe("back");
  });

  test("never writes into another user's row", async () => {
    seedRow(database, {
      id: "row-xxxx",
      userId: OTHER_USER_ID,
      updatedAt: 1_000,
    });

    const body = (await (
      await request("/push", {
        rows: [makeRow({ id: "row-xxxx", transcript: "stolen", revision: 1 })],
      })
    ).json()) as { results: { status: string }[] };

    expect(body.results[0]).toEqual({ id: "row-xxxx", status: "not_found" });
    expect(stored(database, "row-xxxx")?.transcript).toBe("seeded");
    expect(stored(database, "row-xxxx")?.user_id).toBe(OTHER_USER_ID);
  });

  test("throttles rapid pushes on their own window", async () => {
    request = makeRequest(makeEnv(database, { SYNC_PUSH_COOLDOWN_MS: "250" }));

    const first = await request("/push", { rows: [makeRow()] });
    expect(first.status).toBe(200);

    const second = await request("/push", {
      rows: [makeRow({ id: "row-second" })],
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("1");
  });

  test("caps the batch at the free-plan row count", async () => {
    const rows = Array.from({ length: 26 }, (_, index) =>
      makeRow({ id: `row-${index.toString().padStart(4, "0")}` }),
    );

    const res = await request("/push", { rows });
    expect(res.status).toBe(413);
  });
});
