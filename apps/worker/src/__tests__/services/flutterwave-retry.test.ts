import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchRecentSuccessfulTransactions } from "@/services/flutterwave";
import type { Env } from "@/core/types";
import { createTestDatabase } from "@/__tests__/helpers/sqlite-d1";

const TX = {
  id: 123,
  tx_ref: "ekwe_u_monthly_1",
  flw_ref: "flw_1",
  amount: 3000,
  currency: "NGN",
  status: "successful",
  created_at: "2026-09-01T00:00:00Z",
  customer: { id: 1, name: "T", email: "a@example.com", phone_number: null },
};

function flwPage() {
  return Response.json({
    status: "success",
    message: "ok",
    meta: { page_info: { total: 1, current_page: 1, total_pages: 1 } },
    data: [TX],
  });
}

function makeEnv() {
  return {
    DB: createTestDatabase().d1,
    APP_ENV: "test",
    FLUTTERWAVE_SECRET: "secret",
  } as unknown as Env;
}

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetch retry", () => {
  test("retries transient 503 then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return calls < 3 ? new Response("boom", { status: 503 }) : flwPage();
      }),
    );
    const txs = await fetchRecentSuccessfulTransactions(makeEnv(), 2);
    expect(txs).toHaveLength(1);
    expect(calls).toBe(3);
  });

  test("does not retry deterministic 401", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("no", { status: 401 });
      }),
    );
    await expect(
      fetchRecentSuccessfulTransactions(makeEnv(), 2),
    ).rejects.toThrow("Flutterwave API error: 401");
    expect(calls).toBe(1);
  });

  test("gives up after max attempts on persistent 503", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("boom", { status: 503 });
      }),
    );
    await expect(
      fetchRecentSuccessfulTransactions(makeEnv(), 2),
    ).rejects.toThrow("Flutterwave API error: 503");
    expect(calls).toBe(3);
  });
});
