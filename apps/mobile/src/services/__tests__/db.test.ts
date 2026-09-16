import { describe, it, expect, vi, beforeEach } from "vitest";
import { Db } from "../db";
import { openDatabaseSync } from "expo-sqlite";

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
});
