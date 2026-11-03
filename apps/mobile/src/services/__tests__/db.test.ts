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

  it("should count dirty history", () => {
    expect(Db.countDirtyHistory("user_123")).toBe(0);
  });

  it("should report whether a row is dirty", () => {
    expect(Db.isHistoryDirty("row-1")).toBe(false);
  });

  it("should return dirty history", () => {
    expect(Db.getDirtyHistory("user_123")).toEqual([]);
  });

  it("should clean up expired history", () => {
    const res = Db.cleanupExpiredHistory(7);
    expect(typeof res).toBe("number");
  });

  it("should run prepared mutations instead of deferring them", () => {
    Db.markHistoryDeleted("row-1", 1_700_000_000_000);
    Db.clearHistoryDeleted("row-1");
    Db.purgeUserHistory("user_123");

    const deferred = preparedStatements.filter(
      (stmt) => stmt.execute.mock.calls.length > 0,
    );
    expect(deferred).toEqual([]);

    const ran = preparedStatements.filter(
      (stmt) => stmt.run.mock.calls.length > 0,
    );
    expect(ran).toHaveLength(3);
  });
});
