import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryRow } from "@ekwe/shared";

vi.mock("@/store", async () => {
  const { observable } = await import("@legendapp/state");
  return {
    auth$: observable({ user: { id: "u1" }, isPro: false }),
    history$: observable<Record<string, unknown>>({}),
  };
});

vi.mock("@/services/backend", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message?: string) {
      super(message ?? code);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  return { ApiError, apiJson: vi.fn() };
});

vi.mock("@/services/db", () => ({
  Db: {
    hasPendingOutboxRow: vi.fn(() => false),
    insertHistory: vi.fn(),
    setHistoryRevision: vi.fn(),
    deleteOutbox: vi.fn(),
    insertOutbox: vi.fn(),
    incrementOutboxRetry: vi.fn(),
    getPendingOutbox: vi.fn(() => []),
    markOutboxInFlight: vi.fn(),
    applyRemoteDeletion: vi.fn(),
    countDeadOutbox: vi.fn(() => 0),
    reviveDeadOutbox: vi.fn(() => 0),
  },
}));

vi.mock("@/services/mmkv", () => {
  const store = new Map<string, string>();
  return {
    mmkv: {
      getString: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      remove: vi.fn((key: string) => {
        store.delete(key);
      }),
      getAllKeys: vi.fn(() => [...store.keys()]),
      clearAll: vi.fn(() => store.clear()),
    },
  };
});

vi.mock("@/utils/connectivity", () => ({
  checkIsOnline: vi.fn(async () => true),
  isDefinitelyOffline: vi.fn(() => false),
  subscribeToNetwork: vi.fn(() => vi.fn()),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "new-outbox-id"),
}));

import { apiJson, ApiError } from "@/services/backend";
import { Db } from "@/services/db";
import { mmkv } from "@/services/mmkv";
import { serializeOutboxRow } from "@/services/outboxPayload";
import { CloudSync } from "@/services/sync/CloudSync";
import { OutboxDrain } from "@/services/sync/OutboxDrain";
import { history$ } from "@/store";
import type { HistoryEntry } from "@/store";

const NOW = Date.now();

function wireRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: "row-0001",
    type: "translation",
    captureId: "cap-1",
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello",
    translationText: "bonjour",
    transliterationText: null,
    duration: 3,
    sourceApp: "com.whatsapp",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: "gemini",
    createdAt: NOW,
    revision: 1,
    deletedAt: null,
    restore: false,
    ...overrides,
  };
}

function syncedRow(overrides: Partial<HistoryRow> = {}) {
  return { ...wireRow(overrides), updatedAt: NOW };
}

function localEntry(id: string): HistoryEntry {
  return {
    id,
    captureId: null,
    origin: "echo",
    input: "audio",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello",
    translation: null,
    timestamp: NOW,
    duration: 1,
    sourceApp: null,
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: null,
  };
}

function queueRow(row: HistoryRow, outboxId = "ob-1"): void {
  vi.mocked(Db.getPendingOutbox).mockReturnValue([
    { id: outboxId, payload: serializeOutboxRow(row) } as never,
  ]);
}

function mockPush(
  response: unknown,
  config: { syncPushRows?: number; maxHistoryBatchBytes?: number } = {},
): void {
  vi.mocked(apiJson).mockImplementation(async (path: string) => {
    if (path === "/config") {
      return {
        syncPushRows: config.syncPushRows ?? 200,
        maxHistoryBatchBytes: config.maxHistoryBatchBytes ?? 90 * 1024,
      } as never;
    }
    return response as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.clearAll();
  vi.mocked(Db.getPendingOutbox).mockReturnValue([]);
  vi.mocked(Db.hasPendingOutboxRow).mockReturnValue(false);
});

afterEach(() => {
  history$.set({});
});

describe("OutboxDrain", () => {
  it("pushes a pending row and clears it on ok", async () => {
    const row = wireRow();
    queueRow(row);
    mockPush({ results: [{ id: row.id, status: "ok", revision: 2 }] });

    await new OutboxDrain().drain();

    expect(Db.markOutboxInFlight).toHaveBeenCalledWith("ob-1");
    expect(apiJson).toHaveBeenCalledWith(
      "/sync/push",
      expect.objectContaining({ method: "POST", body: { rows: [row] } }),
    );
    expect(Db.setHistoryRevision).toHaveBeenCalledWith(row.id, 2);
    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("adopts the server row on conflict", async () => {
    const row = wireRow();
    const server = syncedRow({ transcript: "server", revision: 4 });
    queueRow(row);
    mockPush({
      results: [{ id: row.id, status: "conflict", revision: 4, row: server }],
    });

    await new OutboxDrain().drain();

    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: row.id,
        transcript: "server",
        revision: 4,
      }),
    );
    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("takes the revision when a conflict has no server row", async () => {
    const row = wireRow();
    queueRow(row);
    mockPush({ results: [{ id: row.id, status: "conflict", revision: 3 }] });

    await new OutboxDrain().drain();

    expect(Db.setHistoryRevision).toHaveBeenCalledWith(row.id, 3);
    expect(Db.insertHistory).not.toHaveBeenCalled();
  });

  it("re-queues a stale delete against the newer revision", async () => {
    const row = wireRow({ deletedAt: NOW, revision: 1 });
    queueRow(row);
    mockPush({
      results: [{ id: row.id, status: "conflict", revision: 5 }],
    });

    await new OutboxDrain().drain();

    expect(Db.insertOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "new-outbox-id",
        payload: expect.any(String),
        userId: "u1",
      }),
    );
    const payload = JSON.parse(
      vi.mocked(Db.insertOutbox).mock.calls[0][0].payload as string,
    ) as HistoryRow;
    expect(payload).toMatchObject({
      id: row.id,
      revision: 5,
      deletedAt: NOW,
      restore: false,
    });
    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("adopts the server row when a delete conflict cannot advance", async () => {
    const row = wireRow({ deletedAt: NOW, revision: 2 });
    const server = syncedRow({ revision: 2, transcript: "server" });
    queueRow(row);
    mockPush({
      results: [{ id: row.id, status: "conflict", revision: 2, row: server }],
    });

    await new OutboxDrain().drain();

    expect(Db.insertOutbox).not.toHaveBeenCalled();
    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, transcript: "server" }),
    );
  });

  it("drops a deleted row from the local cache", async () => {
    const row = wireRow();
    history$[row.id].set(localEntry(row.id));
    queueRow(row);
    mockPush({ results: [{ id: row.id, status: "deleted", revision: 3 }] });

    await new OutboxDrain().drain();

    expect(Db.applyRemoteDeletion).toHaveBeenCalledWith(row.id, 3);
    expect(history$[row.id].get()).toBeUndefined();
    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("clears the outbox when the server has no such row", async () => {
    const row = wireRow();
    queueRow(row);
    mockPush({ results: [{ id: row.id, status: "not_found" }] });

    await new OutboxDrain().drain();

    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("retries a rate-limited push", async () => {
    const row = wireRow();
    queueRow(row);
    vi.mocked(apiJson)
      .mockResolvedValueOnce({
        syncPushRows: 200,
        maxHistoryBatchBytes: 90 * 1024,
      } as never)
      .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many"))
      .mockResolvedValueOnce({
        results: [{ id: row.id, status: "ok", revision: 2 }],
      } as never);

    vi.useFakeTimers();
    const drain = new OutboxDrain().drain();
    await vi.advanceTimersByTimeAsync(1_100);
    await drain;
    vi.useRealTimers();

    expect(Db.deleteOutbox).toHaveBeenCalledWith("ob-1");
  });

  it("counts a failed chunk against every queued row", async () => {
    const row = wireRow();
    queueRow(row);
    vi.mocked(apiJson).mockImplementation(async (path: string) => {
      if (path === "/config") {
        return { syncPushRows: 200, maxHistoryBatchBytes: 90 * 1024 } as never;
      }
      throw new Error("network down");
    });

    await new OutboxDrain().drain();

    expect(Db.incrementOutboxRetry).toHaveBeenCalledWith("ob-1");
    expect(Db.deleteOutbox).not.toHaveBeenCalled();
  });
});

describe("CloudSync", () => {
  function mockPages(...pages: unknown[]): void {
    const mock = vi.mocked(apiJson);
    for (const page of pages) mock.mockResolvedValueOnce(page as never);
  }

  it("applies a page and stores the cursor", async () => {
    const row = syncedRow();
    mockPages(
      {
        rows: [row],
        nextCursor: `${NOW}:${row.id}`,
        hasMore: true,
      },
      { rows: [], nextCursor: null, hasMore: false },
    );

    await new CloudSync().pullFromCloud("u1", false);

    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, userId: "u1" }),
    );
    expect(history$[row.id].get()).toMatchObject({ id: row.id });
    expect(mmkv.set).toHaveBeenCalledWith(
      "sync.cursor.u1.free",
      `${NOW}:${row.id}`,
    );
  });

  it("resumes from the stored cursor", async () => {
    mmkv.set("sync.cursor.u1.free", "123:row-0001");
    mockPages({ rows: [], nextCursor: null, hasMore: false });

    await new CloudSync().pullFromCloud("u1", false);

    expect(apiJson).toHaveBeenCalledWith(
      "/sync/pull",
      expect.objectContaining({ body: { cursor: "123:row-0001" } }),
    );
  });

  it("keys the cursor by tier so an upgrade re-pulls the window", async () => {
    mockPages({ rows: [], nextCursor: "456:row-0002", hasMore: false });

    await new CloudSync().pullFromCloud("u1", true);

    expect(mmkv.set).toHaveBeenCalledWith("sync.cursor.u1.pro", "456:row-0002");
  });

  it("applies tombstones from the server", async () => {
    const row = syncedRow({ deletedAt: NOW });
    history$[row.id].set(localEntry(row.id));
    mockPages({ rows: [row], nextCursor: null, hasMore: false });

    await new CloudSync().pullFromCloud("u1", false);

    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, deletedAt: NOW }),
    );
    expect(history$[row.id].get()).toBeUndefined();
  });

  it("keeps a locally pending row instead of overwriting it", async () => {
    const row = syncedRow();
    vi.mocked(Db.hasPendingOutboxRow).mockReturnValue(true);
    mockPages({ rows: [row], nextCursor: null, hasMore: false });

    await new CloudSync().pullFromCloud("u1", false);

    expect(Db.insertHistory).not.toHaveBeenCalled();
  });

  it("skips live rows outside the local retention window", async () => {
    const row = syncedRow({
      createdAt: NOW - 20 * 24 * 60 * 60 * 1000,
    });
    mockPages({ rows: [row], nextCursor: null, hasMore: false });

    await new CloudSync().pullFromCloud("u1", false);

    expect(Db.insertHistory).not.toHaveBeenCalled();
  });

  it("keeps rows that are inside the Paid window", async () => {
    const row = syncedRow({ createdAt: NOW - 20 * 24 * 60 * 60 * 1000 });
    mockPages({ rows: [row], nextCursor: null, hasMore: false });

    await new CloudSync().pullFromCloud("u1", true);

    expect(Db.insertHistory).toHaveBeenCalled();
  });

  it("records a pull failure without throwing", async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(new Error("offline"));
    const sync = new CloudSync();

    await expect(sync.pullFromCloud("u1", false)).resolves.toBeUndefined();
    expect(sync.pullError.get()).toBe("offline");
  });
});
