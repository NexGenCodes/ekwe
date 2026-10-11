import { describe, test, expect, vi } from "vitest";
import {
  describeError,
  isConnectionLost,
  retryOnConnectionLoss,
} from "@/db/retry";
import { logger } from "@/core/logger";
import { mockEnv } from "@/__tests__/setup";

vi.mock("@/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const hoisted = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ id: "default-client" })),
}));

vi.mock("@/db", () => hoisted);

const mockedGetDb = hoisted.getDb;

describe("describeError()", () => {
  test("returns the message of a plain error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  test("unwraps the cause chain that postgres.js and Cloudflare hang off cause", () => {
    // Shape observed in Sentry: the query error carries the SQL text and the
    // real failure — a dropped TCP socket — sits one link down.
    const queryError = Object.assign(new Error("select 1 failed"), {
      cause: new TypeError("Network connection lost."),
    });
    expect(describeError(queryError)).toBe(
      "select 1 failed | Network connection lost.",
    );
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

describe("isConnectionLost()", () => {
  test.each([
    "Network connection lost.",
    "connection terminated unexpectedly",
    "socket hang up",
    "Connection closed",
    "Timed out while waiting for an open slot in the pool.",
  ])("matches %j", (message) => {
    expect(isConnectionLost(new Error(message))).toBe(true);
  });

  test.each([
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
    "CONNECTION_CLOSED_ERROR",
    "57P01",
    "08006",
  ])("matches code %j", (code) => {
    expect(
      isConnectionLost(Object.assign(new Error("query failed"), { code })),
    ).toBe(true);
  });

  test("matches when only the cause carries the signal", () => {
    const error = Object.assign(new Error("insert failed"), {
      cause: new Error("Network connection lost."),
    });
    expect(isConnectionLost(error)).toBe(true);
  });

  test.each([
    "duplicate key value violates unique constraint",
    'syntax error at or near "SELCT"',
    "permission denied for table app_config",
  ])("does not match a query-level failure: %j", (message) => {
    expect(isConnectionLost(new Error(message))).toBe(false);
  });

  test("does not match non-error values", () => {
    expect(isConnectionLost(null)).toBe(false);
    expect(isConnectionLost(undefined)).toBe(false);
  });
});

describe("retryOnConnectionLoss()", () => {
  const env = mockEnv();

  test("returns the first result without retrying", async () => {
    const query = vi.fn().mockResolvedValue("ok");
    await expect(retryOnConnectionLoss(query, env)).resolves.toBe("ok");
    expect(query).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("retries once on a dropped connection", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network connection lost."))
      .mockResolvedValueOnce("recovered");

    await expect(retryOnConnectionLoss(query, env)).resolves.toBe("recovered");
    expect(query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("hands the retry a fresh client, never the failed one", async () => {
    const clients = [{ id: "first" }, { id: "second" }];
    mockedGetDb.mockReset();
    mockedGetDb.mockReturnValueOnce(clients[0]).mockReturnValueOnce(clients[1]);

    const seen: unknown[] = [];
    const query = vi.fn(async (db: unknown) => {
      seen.push(db);
      if (seen.length === 1) throw new Error("Network connection lost.");
      return "ok";
    });

    await expect(retryOnConnectionLoss(query, env)).resolves.toBe("ok");
    expect(seen).toEqual(clients);
  });

  test("propagates the failure when the new client also fails", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error("Network connection lost."));

    await expect(retryOnConnectionLoss(query, env)).rejects.toThrow(
      "Network connection lost.",
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("never retries a query-level error, so counters cannot double-apply", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(
        new Error("duplicate key value violates unique constraint"),
      );

    await expect(retryOnConnectionLoss(query, env)).rejects.toThrow(
      /duplicate key/,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("retries at most once", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error("Network connection lost."));

    await expect(retryOnConnectionLoss(query, env)).rejects.toThrow(
      "Network connection lost.",
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
});
