import { describe, it, expect, vi, beforeEach } from "vitest";
import { observable } from "@legendapp/state";
import { SyncService } from "@/services/syncService";
import { Db } from "@/services/db";

vi.mock("@/store", () => ({
  history$: observable([]),
  auth$: observable({
    session: { access_token: "test-token", user: { id: "test-user" } },
    user: { id: "test-user" },
  }),
}));

vi.mock("../db", () => ({
  Db: {
    cleanupExpiredHistory: vi.fn(() => 0),
    reviveInFlight: vi.fn(() => 0),
    reviveDeadOutbox: vi.fn(() => 0),
    countDeadOutbox: vi.fn(() => 0),
    getRecentHistory: vi.fn(() => []),
    transaction: vi.fn((fn) => fn()),
    insertHistory: vi.fn(),
    insertOutbox: vi.fn(),
    findTranslationByDedupKey: vi.fn(() => null),
    updateTranslationRow: vi.fn(),
    getPendingOutbox: vi.fn(() => []),
    markOutboxInFlight: vi.fn(),
    deleteOutbox: vi.fn(),
    incrementOutboxRetry: vi.fn(),
  },
}));

vi.mock("@/utils/connectivity", () => ({
  checkIsOnline: vi.fn(() => Promise.resolve(true)),
  subscribeToNetwork: vi.fn(() => vi.fn()),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("../mmkv", () => ({
  mmkv: {
    getString: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe("syncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize on start", async () => {
    await SyncService.start();
    expect(Db.cleanupExpiredHistory).toHaveBeenCalled();
    expect(Db.reviveInFlight).toHaveBeenCalled();
    expect(Db.countDeadOutbox).toHaveBeenCalled();
    expect(Db.getRecentHistory).toHaveBeenCalled();
  });

  it("should write history and schedule drain", async () => {
    const id = await SyncService.writeHistory(
      {
        sourceLang: "en",
        targetLang: "es",
        transcript: "hello",
        translation: "hola",
        transliteration: null,
        duration: 1.5,
        sourceApp: "test",
        provider: "test",
        type: "transcription",
      },
      "user123",
    );

    expect(typeof id).toBe("string");
    expect(Db.transaction).toHaveBeenCalled();
    expect(Db.insertHistory).toHaveBeenCalled();
    expect(Db.insertOutbox).toHaveBeenCalled();
  });

  it("should retry dead outbox", async () => {
    await SyncService.retryDeadOutbox();
    expect(Db.reviveDeadOutbox).toHaveBeenCalled();
  });

  it("should page cloud history with the composite (created_at, id) keyset order", async () => {
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const { supabase } = await import("../supabase");
    const from = vi.mocked(supabase.from);

    const fakeChain = {
      select: () => fakeChain,
      eq: () => fakeChain,
      or: () => fakeChain,
      order: (column: string, opts: { ascending: boolean }) => {
        orderCalls.push({ column, ascending: opts.ascending });
        return fakeChain;
      },
      limit: () =>
        Promise.resolve({
          data: [
            { created_at: "2026-09-01T10:00:00.000Z", id: "b" },
            { created_at: "2026-09-01T10:00:00.000Z", id: "a" },
          ],
          error: null,
        }),
    };
    from.mockReturnValue(fakeChain as never);

    const entries = await SyncService.fetchOlderHistory(
      "user123",
      { created_at: "2026-09-01T11:00:00.000Z", id: "z" },
      20,
    );

    expect(entries).toHaveLength(2);
    expect(orderCalls).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });

  it("should skip the keyset filter when paging the newest cloud page (null cursor)", async () => {
    let orCalls = 0;
    const { supabase } = await import("../supabase");
    const from = vi.mocked(supabase.from);

    const fakeChain = {
      select: () => fakeChain,
      eq: () => fakeChain,
      or: () => {
        orCalls += 1;
        return fakeChain;
      },
      order: () => fakeChain,
      limit: () =>
        Promise.resolve({
          data: [{ created_at: "2026-09-05T10:00:00.000Z", id: "c" }],
          error: null,
        }),
    };
    from.mockReturnValue(fakeChain as never);

    const entries = await SyncService.fetchOlderHistory("user123", null, 20);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("c");
    expect(orCalls).toBe(0);
  });
});
