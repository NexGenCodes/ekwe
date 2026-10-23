import { describe, test, expect, vi } from "vitest";
import { describeError, isTransient, retryTransient } from "@/db/retry";

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/core/logger", () => ({ logger }));

function sqliteError(code: string): Error {
  return Object.assign(new Error("D1_ERROR"), { code });
}

describe("describeError", () => {
  test("returns the message of a plain error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  test("unwraps the cause chain", () => {
    const error = Object.assign(new Error("insert failed"), {
      cause: new TypeError("database is locked"),
    });
    expect(describeError(error)).toBe("insert failed | database is locked");
  });

  test("does not repeat an identical message along the chain", () => {
    const error = Object.assign(new Error("same"), {
      cause: new Error("same"),
    });
    expect(describeError(error)).toBe("same");
  });

  test("stops on a self-referencing cause instead of looping", () => {
    const error: { message: string; cause?: unknown } = new Error("loop");
    error.cause = error;
    expect(describeError(error)).toBe("loop");
  });

  test("handles non-error values", () => {
    expect(describeError("plain string")).toBe("");
    expect(describeError(null)).toBe("");
    expect(describeError(undefined)).toBe("");
  });
});

describe("isTransient", () => {
  test.each(["SQLITE_BUSY", "SQLITE_LOCKED"])("matches code %j", (code) => {
    expect(isTransient(sqliteError(code))).toBe(true);
  });

  test.each([
    "D1_ERROR: database is locked",
    "network connection lost",
    "SQLITE_BUSY: database is locked",
  ])("matches message %j", (message) => {
    expect(isTransient(new Error(message))).toBe(true);
  });

  test("matches when only the cause carries the signal", () => {
    const error = Object.assign(new Error("batch failed"), {
      cause: new Error("database is locked"),
    });
    expect(isTransient(error)).toBe(true);
  });

  test.each([
    "UNIQUE constraint failed: users.email_norm",
    "NOT NULL constraint failed: history.id",
    "no such table: history",
    "D1_ERROR: too many SQL variables",
  ])("does not match a statement error: %j", (message) => {
    expect(isTransient(new Error(message))).toBe(false);
  });

  test("does not match non-error values", () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
  });
});

describe("retryTransient", () => {
  test("returns the first result without retrying", async () => {
    const query = vi.fn().mockResolvedValue("ok");
    await expect(retryTransient(query)).resolves.toBe("ok");
    expect(query).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("replays a locked write until it succeeds", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(sqliteError("SQLITE_BUSY"))
      .mockResolvedValueOnce("recovered");

    await expect(retryTransient(query)).resolves.toBe("recovered");
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("never replays a statement error", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(
        new Error("UNIQUE constraint failed: users.email_norm"),
      );

    await expect(retryTransient(query)).rejects.toThrow(/UNIQUE constraint/);
    expect(query).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("gives up after the attempt budget", async () => {
    const query = vi.fn().mockRejectedValue(sqliteError("SQLITE_BUSY"));

    await expect(retryTransient(query)).rejects.toThrow("D1_ERROR");
    expect(query).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
