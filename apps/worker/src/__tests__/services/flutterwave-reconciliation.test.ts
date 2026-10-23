import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from "vitest";

import {
  fetchRecentSuccessfulTransactions,
  getMissingTransactions,
  processMissingTransaction,
  reconcileFlutterwaveTransactions,
} from "@/services/flutterwave";
import type { Env } from "@/core/types";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const USER_ID = "3f7c1d2e-5b6a-4c8d-9e0f-1a2b3c4d5e6f";
const EMAIL = "test@example.com";
const TX_REF = `ekwe_${USER_ID}_monthly_9f8e7d6c`;
const DAY_MS = 86_400_000;

const TX = {
  id: 123,
  tx_ref: TX_REF,
  flw_ref: "flw_123",
  amount: 3000,
  currency: "NGN",
  status: "successful",
  created_at: "2026-09-01T00:00:00Z",
  customer: { id: 1, name: "Test", email: EMAIL, phone_number: null },
  meta: { plan: "ekwe_pro_monthly", amount: 3000, currency: "NGN" },
};

function makeEnv(
  database: TestDatabase,
  overrides: Record<string, unknown> = {},
): Env {
  return {
    DB: database.d1,
    APP_ENV: "test",
    FLUTTERWAVE_SECRET: "test-secret",
    ...overrides,
  } as unknown as Env;
}

function seedUser(database: TestDatabase): void {
  const now = Date.now();
  database.sqlite
    .prepare(
      `INSERT INTO users (id, email, email_norm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, EMAIL, EMAIL, now, now);
}

function seedConfig(database: TestDatabase): void {
  database.sqlite
    .prepare(
      "UPDATE app_config SET local_prices = ?, updated_at = ? WHERE id = 1",
    )
    .run(
      JSON.stringify({
        NGN: { monthly: 3000, annual: 28800 },
        USD: { monthly: 2.23, annual: 21.41 },
      }),
      Date.now(),
    );
}

function flwPage(data: unknown[], totalPages = 1): Response {
  return Response.json({
    status: "success",
    message: "ok",
    meta: {
      page_info: {
        total: data.length,
        current_page: 1,
        total_pages: totalPages,
      },
    },
    data,
  });
}

function stubFlwFetch(...pages: unknown[][]): Mock {
  const fn = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page") ?? "1");
    return flwPage(pages[page - 1] ?? [], pages.length);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function user(database: TestDatabase) {
  return database.sqlite
    .prepare("SELECT tier, pro_expires_at FROM users WHERE id = ?")
    .get(USER_ID) as { tier: string; pro_expires_at: number | null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRecentSuccessfulTransactions", () => {
  test("throws when the secret is not configured", async () => {
    const database = createTestDatabase();
    const env = makeEnv(database, { FLUTTERWAVE_SECRET: undefined });

    await expect(fetchRecentSuccessfulTransactions(env, 2)).rejects.toThrow(
      "FLUTTERWAVE_SECRET not configured",
    );
  });

  test("pages through Flutterwave until total_pages is reached", async () => {
    const database = createTestDatabase();
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }], [{ ...TX, flw_ref: "flw_2" }]);

    const txs = await fetchRecentSuccessfulTransactions(makeEnv(database), 2);

    expect(txs).toHaveLength(2);
    const fetchMock = fetch as Mock;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  test("rejects on a non-OK Flutterwave response", async () => {
    const database = createTestDatabase();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 })),
    );

    await expect(
      fetchRecentSuccessfulTransactions(makeEnv(database), 2),
    ).rejects.toThrow("Flutterwave API error: 503");
  });
});

describe("getMissingTransactions", () => {
  test("returns [] without querying when there are no refs", async () => {
    const database = createTestDatabase();
    const env = makeEnv(database);
    const prepare = vi.spyOn(env.DB, "prepare");

    await expect(getMissingTransactions(env, [])).resolves.toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });

  test("filters out refs already in the ledger", async () => {
    const database = createTestDatabase();
    const now = Date.now();
    database.sqlite
      .prepare(
        `INSERT INTO flutterwave_claims
           (flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("flw_1", USER_ID, TX_REF, 3000, "NGN", now + DAY_MS, now);

    const missing = await getMissingTransactions(makeEnv(database), [
      "flw_1",
      "flw_2",
    ]);

    expect(missing).toEqual(["flw_2"]);
  });

  test("chunks large ref lists", async () => {
    const database = createTestDatabase();
    const refs = Array.from({ length: 120 }, (_, i) => `flw_${i}`);

    const missing = await getMissingTransactions(makeEnv(database), refs);

    expect(missing).toEqual(refs);
  });

  test("throws when the ledger cannot be read", async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error("Database error");
        },
      },
    } as unknown as Env;

    await expect(getMissingTransactions(env, ["flw_1"])).rejects.toThrow(
      "Failed to fetch missing transactions",
    );
  });
});

describe("reconcileFlutterwaveTransactions", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    database = createTestDatabase();
    seedUser(database);
    seedConfig(database);
    env = makeEnv(database);
  });

  test("grants Paid for a transaction the webhook never delivered", async () => {
    stubFlwFetch([TX]);

    await expect(
      reconcileFlutterwaveTransactions(env),
    ).resolves.toBeUndefined();

    expect(user(database).tier).toBe("PREMIUM");
    expect(user(database).pro_expires_at).toBeGreaterThan(
      Date.now() + 29 * DAY_MS,
    );
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS n FROM flutterwave_claims")
        .get(),
    ).toEqual({ n: 1 });
  });

  test("skips reconciliation when there are no recent transactions", async () => {
    stubFlwFetch([]);
    const processFn = vi.fn(async () => true);

    await reconcileFlutterwaveTransactions(env, processFn);

    expect(processFn).not.toHaveBeenCalled();
  });

  test("does not re-process a transaction already in the ledger", async () => {
    stubFlwFetch([TX]);
    await reconcileFlutterwaveTransactions(env);
    const granted = user(database).pro_expires_at;

    const processFn = vi.fn(processMissingTransaction);
    await reconcileFlutterwaveTransactions(env, processFn);

    expect(processFn).not.toHaveBeenCalled();
    expect(user(database).pro_expires_at).toBe(granted);
  });

  test("rethrows when the Flutterwave fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 })),
    );
    const processFn = vi.fn(async () => true);

    await expect(
      reconcileFlutterwaveTransactions(env, processFn),
    ).rejects.toThrow("Flutterwave API error: 503");
    expect(processFn).not.toHaveBeenCalled();
  });

  test("keeps going when one ref is transiently failing", async () => {
    stubFlwFetch([
      { ...TX, flw_ref: "flw_1" },
      { ...TX, flw_ref: "flw_2" },
    ]);
    const processFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(true);

    await expect(
      reconcileFlutterwaveTransactions(env, processFn),
    ).resolves.toBeUndefined();

    expect(processFn).toHaveBeenCalledTimes(2);
  });

  test("throws when nothing was applied and failures were transient", async () => {
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }]);
    const processFn = vi.fn().mockRejectedValue(new Error("transient"));

    await expect(
      reconcileFlutterwaveTransactions(env, processFn),
    ).rejects.toThrow("Triggering queue retry");
  });

  test("does not throw when failures are terminal", async () => {
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }]);
    const processFn = vi.fn().mockResolvedValue(false);

    await expect(
      reconcileFlutterwaveTransactions(env, processFn),
    ).resolves.toBeUndefined();
  });
});
