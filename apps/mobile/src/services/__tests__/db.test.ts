import { describe, it, expect, vi, beforeEach } from "vitest";
import { Db } from "@/services/db";
import { openDatabaseSync } from "expo-sqlite";
import * as drizzleExpoSqlite from "drizzle-orm/expo-sqlite";

type PreparedSpy = {
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

const preparedStatements = (
  drizzleExpoSqlite as unknown as { __preparedStatements: PreparedSpy[] }
).__preparedStatements;

describe("Db service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run transactions", () => {
    const mockDb = openDatabaseSync("ekwe.db");
    const fn = vi.fn();
    Db.transaction(fn);

    expect(mockDb.execSync).toHaveBeenCalledWith("BEGIN EXCLUSIVE TRANSACTION");
    expect(fn).toHaveBeenCalled();
    expect(mockDb.execSync).toHaveBeenCalledWith("COMMIT");
  });

  it("should rollback transaction on error", () => {
    const mockDb = openDatabaseSync("ekwe.db");
    const fn = vi.fn(() => {
      throw new Error("test error");
    });

    expect(() => Db.transaction(fn)).toThrow("test error");
    expect(mockDb.execSync).toHaveBeenCalledWith("BEGIN EXCLUSIVE TRANSACTION");
    expect(mockDb.execSync).toHaveBeenCalledWith("ROLLBACK");
  });

  it("should return history from searchHistory", () => {
    const res = Db.searchHistory("user_123", "query");
    expect(Array.isArray(res)).toBe(true);
  });

  it("should return empty array when searchHistory is missing query", () => {
    const res = Db.searchHistory("user_123", "");
    expect(res).toEqual([]);
  });

  it("should return empty array when searchHistory is just spaces", () => {
    const res = Db.searchHistory("user_123", "   ");
    expect(res).toEqual([]);
  });

  it("should count dead outbox", () => {
    const res = Db.countDeadOutbox("user_123");
    expect(res).toBe(0);
  });

  it("should revive in-flight outbox", () => {
    const res = Db.reviveInFlight();
    expect(typeof res).toBe("number");
  });

  it("should revive dead outbox", () => {
    const res = Db.reviveDeadOutbox();
    expect(typeof res).toBe("number");
  });

  it("should increment outbox retry", () => {
    expect(() => Db.incrementOutboxRetry("outbox_123")).not.toThrow();
  });

  it("should clean up expired history", () => {
    const res = Db.cleanupExpiredHistory(7);
    expect(typeof res).toBe("number");
  });

  // `execute()` on a sync prepared statement only materializes an
  // `ExecuteResultSync` thunk, so a delete or update routed through it parses,
  // throws nothing, and never reaches SQLite. That is what left the outbox
  // re-pushing the same rows forever: every drain "succeeded" and deleted
  // nothing.
  it("should run prepared mutations instead of deferring them", () => {
    Db.deleteHistory("row-1");
    Db.deleteOutbox("row-1");
    Db.markOutboxInFlight("row-1");
    Db.reviveInFlight();
    Db.reviveDeadOutbox();
    Db.purgeUserHistory("user_123");
    Db.purgeUserOutbox("user_123");

    const deferred = preparedStatements.filter(
      (stmt) => stmt.execute.mock.calls.length > 0,
    );
    expect(deferred).toEqual([]);

    const ran = preparedStatements.filter(
      (stmt) => stmt.run.mock.calls.length > 0,
    );
    expect(ran).toHaveLength(7);
  });

  it("should report how many outbox rows a revive touched", () => {
    expect(Db.reviveInFlight()).toBe(0);
    expect(Db.reviveDeadOutbox()).toBe(0);
  });
});
