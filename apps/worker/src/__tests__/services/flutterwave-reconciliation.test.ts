import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";

vi.mock("../../services/supabase", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/supabase")>();
  return { ...mod, supabasePost: vi.fn() };
});

vi.mock("../../routes/flutterwave", () => ({
  processMissingTransaction: vi.fn(),
}));

import {
  fetchRecentSuccessfulTransactions,
  getMissingTransactions,
  reconcileFlutterwaveTransactions,
} from "../../services/flutterwave_reconciliation";
import { supabasePost } from "../../services/supabase";
import { processMissingTransaction } from "../../routes/flutterwave";
import { mockEnv } from "../setup";
import type { Env } from "../../core/types";

const mockedSupabasePost = supabasePost as Mock;
const mockProcessMissing = processMissingTransaction as Mock;

const TX = {
  id: 123,
  tx_ref: "ekwe_tx_abc",
  flw_ref: "flw_123",
  amount: 2.23,
  currency: "USD",
  status: "successful",
  created_at: "2026-09-01T00:00:00Z",
  customer: { id: 1, name: "Test", email: "a@b.com", phone_number: null },
};

function env(): Env {
  return mockEnv({ FLUTTERWAVE_SECRET: "test-secret" }) as unknown as Env;
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

function okRpc(missingRefs: string[]): void {
  mockedSupabasePost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => missingRefs.map((missing_ref) => ({ missing_ref })),
  });
}

function failRpc(status = 500): void {
  mockedSupabasePost.mockResolvedValue({
    ok: false,
    status,
    text: async () => "RPC error",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRecentSuccessfulTransactions", () => {
  test("throws when the secret is not configured", async () => {
    const noSecret = mockEnv() as unknown as Env;
    await expect(
      fetchRecentSuccessfulTransactions(noSecret, 2),
    ).rejects.toThrow("FLUTTERWAVE_SECRET not configured");
  });

  test("pages through Flutterwave until total_pages is reached", async () => {
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }], [{ ...TX, flw_ref: "flw_2" }]);

    const txs = await fetchRecentSuccessfulTransactions(env(), 2);

    expect(txs).toHaveLength(2);
    const fetchMock = fetch as Mock;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  test("rejects on a non-OK Flutterwave response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 })),
    );
    await expect(fetchRecentSuccessfulTransactions(env(), 2)).rejects.toThrow(
      "Flutterwave API error: 503",
    );
  });
});

describe("getMissingTransactions", () => {
  test("returns [] without calling the RPC when there are no refs", async () => {
    const missing = await getMissingTransactions(env(), []);

    expect(missing).toEqual([]);
    expect(mockedSupabasePost).not.toHaveBeenCalled();
  });

  test("maps missing_ref results from the RPC", async () => {
    mockedSupabasePost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ missing_ref: "flw_1" }, { missing_ref: "flw_2" }],
    });

    const missing = await getMissingTransactions(env(), ["flw_1", "flw_2"]);

    expect(missing).toEqual(["flw_1", "flw_2"]);
    expect(mockedSupabasePost).toHaveBeenCalledWith(
      expect.anything(),
      "/rest/v1/rpc/get_missing_flutterwave_transactions",
      { p_flw_refs: ["flw_1", "flw_2"] },
    );
  });

  test("throws when the RPC fails so the queue consumer can retry", async () => {
    mockedSupabasePost.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "RPC error",
    });

    await expect(getMissingTransactions(env(), ["flw_1"])).rejects.toThrow(
      "Failed to fetch missing transactions",
    );
  });
});

describe("reconcileFlutterwaveTransactions", () => {
  test("processes a missing transaction end to end", async () => {
    stubFlwFetch([TX]);
    okRpc(["flw_123"]);
    mockProcessMissing.mockResolvedValue(true);

    await expect(
      reconcileFlutterwaveTransactions(env()),
    ).resolves.toBeUndefined();

    expect(mockedSupabasePost).toHaveBeenCalledWith(
      expect.anything(),
      "/rest/v1/rpc/get_missing_flutterwave_transactions",
      { p_flw_refs: ["flw_123"] },
    );
    expect(mockProcessMissing).toHaveBeenCalledTimes(1);
  });

  test("skips reconciliation when there are no recent transactions", async () => {
    stubFlwFetch([]);

    await expect(
      reconcileFlutterwaveTransactions(env()),
    ).resolves.toBeUndefined();

    expect(mockedSupabasePost).not.toHaveBeenCalled();
    expect(mockProcessMissing).not.toHaveBeenCalled();
  });

  test("rethrows when the missing-transactions RPC fails (queue retry)", async () => {
    stubFlwFetch([TX]);
    failRpc(500);

    await expect(reconcileFlutterwaveTransactions(env())).rejects.toThrow(
      "Failed to fetch missing transactions",
    );
    expect(mockProcessMissing).not.toHaveBeenCalled();
  });

  test("rethrows when the Flutterwave fetch itself fails (queue retry)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 })),
    );

    await expect(reconcileFlutterwaveTransactions(env())).rejects.toThrow(
      "Flutterwave API error: 503",
    );
    expect(mockProcessMissing).not.toHaveBeenCalled();
  });

  test("a single transient ref failure does not abort the remaining refs", async () => {
    stubFlwFetch([
      { ...TX, flw_ref: "flw_1" },
      { ...TX, flw_ref: "flw_2" },
    ]);
    okRpc(["flw_1", "flw_2"]);
    mockProcessMissing
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(true);

    await expect(
      reconcileFlutterwaveTransactions(env()),
    ).resolves.toBeUndefined();

    expect(mockProcessMissing).toHaveBeenCalledTimes(2);
  });

  test("rethrows when zero transactions applied and at least one was transient", async () => {
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }]);
    okRpc(["flw_1"]);
    mockProcessMissing.mockRejectedValue(new Error("transient"));

    await expect(reconcileFlutterwaveTransactions(env())).rejects.toThrow(
      "Triggering queue retry",
    );
  });

  test("does not throw when refs failed terminally (nothing to retry)", async () => {
    stubFlwFetch([{ ...TX, flw_ref: "flw_1" }]);
    okRpc(["flw_1"]);
    mockProcessMissing.mockResolvedValue(false);

    await expect(
      reconcileFlutterwaveTransactions(env()),
    ).resolves.toBeUndefined();
  });
});
