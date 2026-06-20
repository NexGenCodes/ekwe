import { observable } from "@legendapp/state";

import { SyncService } from "../SyncService";
import { Db } from "../db";

import { supabase } from "@/services/supabase";
import * as netInfo from "@/utils/netInfo";

jest.mock("../db", () => ({
  Db: {
    transaction: jest.fn((cb) => cb()),
    insertHistory: jest.fn(),
    insertOutbox: jest.fn(),
    updateHistoryTranslation: jest.fn(),
    deleteHistory: jest.fn(),
    deleteHistoryBatch: jest.fn(),
    getPendingOutbox: jest.fn(() => []),
    markOutboxInFlight: jest.fn(),
    deleteOutbox: jest.fn(),
    incrementOutboxRetry: jest.fn(),
    getRecentHistory: jest.fn(() => []),
    cleanupExpiredHistory: jest.fn(),
    cleanupDeadOutbox: jest.fn(),
    cleanupStalePendingOutbox: jest.fn(),
    getDeadOutboxCount: jest.fn(() => 0),
  },
}));

jest.mock("@/services/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn().mockResolvedValue({ error: null }),
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    })),
    auth: {
      onAuthStateChange: jest.fn(),
    },
  },
}));

jest.mock("@/utils/netInfo", () => ({
  checkIsOnline: jest.fn().mockResolvedValue(true),
  subscribeToNetwork: jest.fn(() => jest.fn()),
}));

jest.mock("@/store", () => {
  const { observable } = jest.requireActual("@legendapp/state");
  const mockHistory$ = observable({});
  return {
    history$: mockHistory$,
    audio$: { get: jest.fn() },
    audioActions: {},
    settings$: {},
  };
});

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "mock-uuid-123"),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("SyncService", () => {
  let history$: ReturnType<typeof observable<Record<string, unknown>>>;

  beforeEach(() => {
    jest.clearAllMocks();
    history$ = jest.requireMock("@/store").history$;
    history$.set({}); // Reset legend state
  });

  describe("writeHistory", () => {
    it("inserts into Db and Outbox, and triggers pushToCloud", async () => {
      const payload = {
        sourceLang: "en",
        targetLang: "es",
        transcript: "Hello",
        translation: "Hola",
        transliteration: null,
        duration: 1000,
        sourceApp: "test",
        provider: "groq",
      };

      (Db.getPendingOutbox as jest.Mock).mockReturnValue([
        {
          id: "mock-uuid-123",
          payload: JSON.stringify({ action: "upsert", ...payload }),
          user_id: "user-1",
        },
      ]);

      const id = await SyncService.writeHistory(payload, "user-1");

      expect(id).toBe("mock-uuid-123");
      expect(Db.insertHistory).toHaveBeenCalled();
      expect(Db.insertOutbox).toHaveBeenCalled();

      // Wait a tick for pushToCloud promise to resolve
      await new Promise(process.nextTick);

      expect(Db.deleteOutbox).toHaveBeenCalledWith("mock-uuid-123");
      const historyEntry = history$[id].get();
      expect(historyEntry).toBeDefined();
      expect((historyEntry as { transcript?: string })?.transcript).toBe("Hello");
    });
  });

  describe("drain", () => {
    it("does nothing if offline", async () => {
      (netInfo.checkIsOnline as jest.Mock).mockResolvedValueOnce(false);
      (Db.getPendingOutbox as jest.Mock).mockReturnValue([{ id: "1" }]);

      await SyncService.drain();

      // Returns early from pushToCloud, but calls refreshPendingCount in finally block
      expect(Db.getPendingOutbox).toHaveBeenCalledTimes(1);
    });

    it("processes all pending entries when online", async () => {
      (netInfo.checkIsOnline as jest.Mock).mockResolvedValueOnce(true);
      (Db.getPendingOutbox as jest.Mock)
        .mockReturnValueOnce([
          {
            id: "1",
            payload: JSON.stringify({ action: "upsert", transcript: "A" }),
            user_id: "u1",
          },
          {
            id: "2",
            payload: JSON.stringify({ action: "delete", id: "target-id" }),
            user_id: "u1",
          },
        ])
        // Mock getPendingOutbox calls from inside pushToCloud
        .mockReturnValue([
          {
            id: "1",
            payload: JSON.stringify({ action: "upsert", transcript: "A" }),
            user_id: "u1",
          },
          {
            id: "2",
            payload: JSON.stringify({ action: "delete", id: "target-id" }),
            user_id: "u1",
          },
        ]);

      await SyncService.drain();

      expect(Db.markOutboxInFlight).toHaveBeenCalledTimes(2);
      expect(Db.deleteOutbox).toHaveBeenCalledTimes(2);
      expect(supabase.from).toHaveBeenCalledWith("history");
    });
  });

  describe("deleteHistory", () => {
    it("adds delete action to outbox and removes from history state", async () => {
      history$.set({ "target-id": { id: "target-id" } as unknown as never });

      await SyncService.deleteHistory("target-id", "user-1");

      expect(Db.deleteHistory).toHaveBeenCalledWith("target-id");
      expect(Db.insertOutbox).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.stringContaining('"action":"delete"'),
        }),
      );
      expect(history$["target-id"].get()).toBeUndefined();
    });
  });
});
