jest.mock("@op-engineering/op-sqlite", () => ({
  open: jest.fn(() => {
    const historyRows: Record<string, unknown>[] = [];
    const outboxRows: Record<string, unknown>[] = [];

    const executeSync = jest.fn((sql: string, params?: unknown[]) => {
      const upper = sql.trim().toUpperCase();

      if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA")) {
        if (sql.includes("COUNT")) {
          return { rows: [{ count: historyRows.length }], rowsAffected: 0 };
        }
        const getLimit = (): number => {
          if (!sql.includes("LIMIT") || !params || params.length === 0)
            return Infinity;
          const limitPos = sql.indexOf("LIMIT");
          const qBefore = (sql.slice(0, limitPos).match(/\?/g) || []).length;
          const val = params[qBefore];
          return typeof val === "number" ? val : Infinity;
        };
        const limit = getLimit();
        if (sql.includes("outbox")) {
          return { rows: [...outboxRows].slice(0, limit), rowsAffected: 0 };
        }
        return { rows: [...historyRows].slice(0, limit), rowsAffected: 0 };
      }

      if (upper.startsWith("INSERT") || upper.startsWith("UPDATE")) {
        if (sql.includes("history") && params) {
          historyRows.push({
            id: params[0],
            user_id: params[1],
            source_lang: params[2],
            target_lang: params[3],
            transcript: params[4],
            translation_text: params[5],
            transliteration_text: params[6],
            duration: params[7],
            source_app: params[8],
            provider: params[9],
            created_at: params[10],
            deleted: params[11] ?? 0,
          });
        }
        if (sql.includes("outbox") && params) {
          outboxRows.push({
            id: params[0],
            payload: params[1],
            user_id: params[2],
            retries: 0,
            last_attempt: null,
            created_at: params[3],
            status: "pending",
          });
        }
        return { rows: [], rowsAffected: 1 };
      }

      if (upper.startsWith("DELETE")) {
        if (sql.includes("WHERE id = ?") && params?.[0]) {
          const id = params[0] as string;
          const hIdx = historyRows.findIndex((r) => r.id === id);
          if (hIdx >= 0) historyRows.splice(hIdx, 1);
          const oIdx = outboxRows.findIndex((r) => r.id === id);
          if (oIdx >= 0) outboxRows.splice(oIdx, 1);
        } else if (sql.includes("WHERE id IN")) {
          const ids = params as string[];
          for (let i = historyRows.length - 1; i >= 0; i--) {
            if (ids.includes(historyRows[i].id as string)) {
              historyRows.splice(i, 1);
            }
          }
        } else if (sql.includes("history")) {
          historyRows.length = 0;
        } else if (sql.includes("outbox")) {
          outboxRows.length = 0;
        }
        return { rows: [], rowsAffected: 1 };
      }

      if (
        upper.startsWith("BEGIN") ||
        upper.startsWith("COMMIT") ||
        upper.startsWith("ROLLBACK")
      ) {
        return { rows: [], rowsAffected: 0 };
      }

      return { rows: [], rowsAffected: 0 };
    });

    return { executeSync };
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const sampleRow = {
  id: "test-id",
  user_id: "user-1",
  source_lang: "en",
  target_lang: "es",
  transcript: "hello",
  translation_text: "hola",
  transliteration_text: null,
  duration: 5.0,
  source_app: "Ekwe",
  provider: "gemini",
  created_at: "2024-01-01T00:00:00.000Z",
};

describe("Db", () => {
  let Db: typeof import("../db").Db;

  beforeEach(() => {
    jest.resetModules();
    const dbModule = require("../db");
    Db = dbModule.Db;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("insertHistory", () => {
    it("inserts a history row", () => {
      Db.insertHistory(sampleRow);
      const history = Db.getRecentHistory(10);
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe("test-id");
    });
  });

  describe("getRecentHistory", () => {
    it("returns empty array when no history", () => {
      const history = Db.getRecentHistory(10);
      expect(history).toEqual([]);
    });

    it("returns inserted rows in order", () => {
      Db.insertHistory(sampleRow);
      const row2 = {
        ...sampleRow,
        id: "test-id-2",
        created_at: "2024-01-02T00:00:00.000Z",
      };
      Db.insertHistory(row2);

      const history = Db.getRecentHistory(10);
      expect(history).toHaveLength(2);
    });
  });

  describe("getHistoryCount", () => {
    it("returns 0 when no rows", () => {
      expect(Db.getHistoryCount()).toBe(0);
    });

    it("returns correct count", () => {
      Db.insertHistory(sampleRow);
      expect(Db.getHistoryCount()).toBe(1);
    });
  });

  describe("getHistoryPage", () => {
    it("returns paginated results", () => {
      for (let i = 0; i < 5; i++) {
        Db.insertHistory({ ...sampleRow, id: `test-id-${i}` });
      }
      const page = Db.getHistoryPage(2, 0);
      expect(page).toHaveLength(2);
    });
  });

  describe("deleteHistory", () => {
    it("deletes a row by id", () => {
      Db.insertHistory(sampleRow);
      Db.deleteHistory("test-id");
      expect(Db.getHistoryCount()).toBe(0);
    });
  });

  describe("deleteHistoryBatch", () => {
    it("deletes multiple rows", () => {
      Db.insertHistory(sampleRow);
      Db.insertHistory({ ...sampleRow, id: "test-id-2" });
      Db.deleteHistoryBatch(["test-id", "test-id-2"]);
      expect(Db.getHistoryCount()).toBe(0);
    });

    it("does nothing with empty array", () => {
      Db.insertHistory(sampleRow);
      Db.deleteHistoryBatch([]);
      expect(Db.getHistoryCount()).toBe(1);
    });
  });

  describe("updateHistoryTranslation", () => {
    it("runs without error", () => {
      Db.insertHistory(sampleRow);
      expect(() => {
        Db.updateHistoryTranslation(
          "test-id",
          "updated-hola",
          "updated-trans",
          "fr",
        );
      }).not.toThrow();
    });
  });

  describe("searchHistory", () => {
    it("returns empty array for empty query", () => {
      const results = Db.searchHistory("");
      expect(results).toEqual([]);
    });
  });

  describe("outbox operations", () => {
    it("inserts and retrieves pending outbox rows", () => {
      Db.insertOutbox({
        id: "outbox-1",
        payload: JSON.stringify({ text: "test" }),
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
      });
      const pending = Db.getPendingOutbox();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe("outbox-1");
    });

    it("deletes outbox row", () => {
      Db.insertOutbox({
        id: "outbox-1",
        payload: "{}",
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
      });
      Db.deleteOutbox("outbox-1");
      expect(Db.getPendingOutbox()).toHaveLength(0);
    });

    it("increments retry count", () => {
      Db.insertOutbox({
        id: "outbox-1",
        payload: "{}",
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
      });
      expect(() => Db.incrementOutboxRetry("outbox-1")).not.toThrow();
    });

    it("marks outbox as in_flight", () => {
      Db.insertOutbox({
        id: "outbox-1",
        payload: "{}",
        user_id: "user-1",
        created_at: "2024-01-01T00:00:00.000Z",
      });
      expect(() => Db.markOutboxInFlight("outbox-1")).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("cleanupExpiredHistory runs without error", () => {
      const count = Db.cleanupExpiredHistory(30);
      expect(typeof count).toBe("number");
    });

    it("cleanupDeadOutbox runs without error", () => {
      const count = Db.cleanupDeadOutbox();
      expect(typeof count).toBe("number");
    });

    it("cleanupStalePendingOutbox runs without error", () => {
      const count = Db.cleanupStalePendingOutbox();
      expect(typeof count).toBe("number");
    });
  });

  describe("transaction", () => {
    it("commits on success", () => {
      Db.transaction(() => {
        Db.insertHistory(sampleRow);
      });
      expect(Db.getHistoryCount()).toBe(1);
    });

    it("rolls back on error", () => {
      expect(() => {
        Db.transaction(() => {
          Db.insertHistory(sampleRow);
          throw new Error("rollback");
        });
      }).toThrow("rollback");
    });
  });
});
