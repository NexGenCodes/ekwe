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
    isHistoryDirty: vi.fn(() => false),
    insertHistory: vi.fn(),
    setHistoryRevision: vi.fn(),
    markHistoryClean: vi.fn(),
    applyRemoteDeletion: vi.fn(),
    getDirtyHistory: vi.fn(() => []),
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

import { apiJson, ApiError } from "@/services/backend";
import { Db } from "@/services/db";
import { mmkv } from "@/services/mmkv";
import { CloudSync } from "@/services/sync/CloudSync";
import { HistoryPush } from "@/services/sync/HistoryPush";
import { history$ } from "@/store";
import type { HistoryEntry } from "@/store";
import type { HistoryRow as LocalHistoryRow } from "@/services/db";

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

function localRow(overrides: Partial<LocalHistoryRow> = {}): LocalHistoryRow {
  return {
    id: "row-0001",
    userId: "u1",
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
    createdAt: new Date(NOW).toISOString(),
    revision: 1,
    entryType: "translation",
    deletedAt: null,
    dirty: 1,
    restore: 0,
    ...overrides,
  };
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

function queueRows(rows: LocalHistoryRow[]): void {
  vi.mocked(Db.getDirtyHistory).mockReturnValue(rows);
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
  vi.mocked(Db.getDirtyHistory).mockReturnValue([]);
  vi.mocked(Db.isHistoryDirty).mockReturnValue(false);
});

afterEach(() => {
  history$.set({});
});

describe("HistoryPush", () => {
  it("pushes a dirty row and clears it on ok", async () => {
    queueRows([localRow()]);
    mockPush({ results: [{ id: "row-0001", status: "ok", revision: 2 }] });

    await new HistoryPush().push();

    expect(apiJson).toHaveBeenCalledWith(
      "/sync/push",
      expect.objectContaining({
        method: "POST",
        body: {
          rows: [expect.objectContaining({ id: "row-0001", revision: 1 })],
        },
      }),
    );
    expect(Db.markHistoryClean).toHaveBeenCalledWith("row-0001", 2);
  });

  it("sends the restore flag for a pending Undo", async () => {
    queueRows([localRow({ restore: 1 })]);

    await new HistoryPush().push();

    const pushCall = vi
      .mocked(apiJson)
      .mock.calls.find(([path]) => path === "/sync/push");
    const body = pushCall?.[1]?.body as { rows: HistoryRow[] };
    expect(body.rows[0]).toMatchObject({ restore: true, deletedAt: null });
  });

  it("adopts the server row on conflict", async () => {
    queueRows([localRow()]);
    const server = syncedRow({ transcript: "server", revision: 4 });
    mockPush({
      results: [
        { id: "row-0001", status: "conflict", revision: 4, row: server },
      ],
    });

    await new HistoryPush().push();

    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "row-0001",
        transcript: "server",
        revision: 4,
        dirty: 0,
      }),
    );
  });

  it("takes the revision when a conflict has no server row", async () => {
    queueRows([localRow()]);
    mockPush({
      results: [{ id: "row-0001", status: "conflict", revision: 3 }],
    });

    await new HistoryPush().push();

    expect(Db.markHistoryClean).toHaveBeenCalledWith("row-0001", 3);
    expect(Db.insertHistory).not.toHaveBeenCalled();
  });

  it("retries a stale delete against the newer revision", async () => {
    queueRows([localRow({ deletedAt: NOW, revision: 1 })]);
    mockPush({
      results: [{ id: "row-0001", status: "conflict", revision: 5 }],
    });

    await new HistoryPush().push();

    expect(Db.setHistoryRevision).toHaveBeenCalledWith("row-0001", 5);
    expect(Db.markHistoryClean).not.toHaveBeenCalled();
    expect(Db.applyRemoteDeletion).not.toHaveBeenCalled();
  });

  it("adopts the server row when a delete conflict cannot advance", async () => {
    queueRows([localRow({ deletedAt: NOW, revision: 2 })]);
    const server = syncedRow({ revision: 2, transcript: "server" });
    mockPush({
      results: [
        { id: "row-0001", status: "conflict", revision: 2, row: server },
      ],
    });

    await new HistoryPush().push();

    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: "row-0001", transcript: "server" }),
    );
  });

  it("drops a deleted row from the local cache", async () => {
    const row = localRow();
    history$[row.id].set(localEntry(row.id));
    queueRows([row]);
    mockPush({ results: [{ id: row.id, status: "deleted", revision: 3 }] });

    await new HistoryPush().push();

    expect(Db.applyRemoteDeletion).toHaveBeenCalledWith(row.id, 3);
    expect(history$[row.id].get()).toBeUndefined();
  });

  it("keeps a live row dirty when the server has no such row", async () => {
    queueRows([localRow()]);
    mockPush({ results: [{ id: "row-0001", status: "not_found" }] });

    await new HistoryPush().push();

    expect(Db.markHistoryClean).not.toHaveBeenCalled();
    expect(Db.applyRemoteDeletion).not.toHaveBeenCalled();
  });

  it("drops a local tombstone the server never had", async () => {
    const row = localRow({ deletedAt: NOW });
    queueRows([row]);
    mockPush({ results: [{ id: row.id, status: "not_found" }] });

    await new HistoryPush().push();

    expect(Db.applyRemoteDeletion).toHaveBeenCalledWith(row.id, row.revision);
  });

  it("retries a rate-limited push", async () => {
    queueRows([localRow()]);
    vi.mocked(apiJson)
      .mockResolvedValueOnce({
        syncPushRows: 200,
        maxHistoryBatchBytes: 90 * 1024,
      } as never)
      .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many"))
      .mockResolvedValueOnce({
        results: [{ id: "row-0001", status: "ok", revision: 2 }],
      } as never);

    vi.useFakeTimers();
    const push = new HistoryPush().push();
    await vi.advanceTimersByTimeAsync(1_100);
    await push;
    vi.useRealTimers();

    expect(Db.markHistoryClean).toHaveBeenCalledWith("row-0001", 2);
  });

  it("leaves rows dirty when a chunk fails", async () => {
    queueRows([localRow()]);
    vi.mocked(apiJson).mockImplementation(async (path: string) => {
      if (path === "/config") {
        return { syncPushRows: 200, maxHistoryBatchBytes: 90 * 1024 } as never;
      }
      throw new Error("network down");
    });

    await new HistoryPush().push();

    expect(Db.markHistoryClean).not.toHaveBeenCalled();
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
      expect.objectContaining({ id: row.id, userId: "u1", dirty: 0 }),
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

  it("keeps a locally dirty row instead of overwriting it", async () => {
    const row = syncedRow();
    vi.mocked(Db.isHistoryDirty).mockReturnValue(true);
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
