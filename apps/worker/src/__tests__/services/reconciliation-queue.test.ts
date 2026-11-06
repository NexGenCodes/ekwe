import { describe, expect, test, vi } from "vitest";
import {
  handleReconciliationQueue,
  isReconciliationMessage,
  enqueueReconciliation,
} from "@/services/reconciliation-queue";
import type { Env } from "@/core/types";

function fakeBatch(bodies: unknown[]) {
  const messages = bodies.map((body) => ({
    id: "m1",
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  return {
    messages,
    queue: "ekwe-reconciliation-retry",
  } as unknown as MessageBatch<{
    type: "flutterwave-reconcile";
    daysAgo: number;
    originalAt: string;
    attempt: number;
  }>;
}

describe("isReconciliationMessage", () => {
  test("matches reconciliation shape, rejects webhook shape", () => {
    expect(isReconciliationMessage({ type: "flutterwave-reconcile" })).toBe(
      true,
    );
    expect(isReconciliationMessage({ provider: "flutterwave" })).toBe(false);
    expect(isReconciliationMessage(null)).toBe(false);
  });
});

describe("enqueueReconciliation", () => {
  test("sends to queue when bound", async () => {
    const send = vi.fn(async () => {});
    const env = { RECONCILIATION_QUEUE: { send } } as unknown as Env;
    await expect(enqueueReconciliation(env, 2)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "flutterwave-reconcile" }),
    );
  });

  test("returns false when queue not bound (e.g. tests, dev without queue)", async () => {
    await expect(enqueueReconciliation({} as Env, 2)).resolves.toBe(false);
  });
});

describe("handleReconciliationQueue", () => {
  test("acks on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "success",
          message: "ok",
          meta: { page_info: { total: 0, current_page: 1, total_pages: 1 } },
          data: [],
        }),
      ),
    );
    const env = {
      DB: {} as never,
      APP_ENV: "test",
      FLUTTERWAVE_SECRET: "s",
    } as unknown as Env;
    const batch = fakeBatch([
      {
        type: "flutterwave-reconcile",
        daysAgo: 2,
        originalAt: "now",
        attempt: 1,
      },
    ]);
    await handleReconciliationQueue(batch, env);
    expect(
      (batch.messages[0].ack as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(1);
  });

  test("retries on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 503 })),
    );
    vi.spyOn(Math, "random").mockReturnValue(0);
    const env = {
      DB: {} as never,
      APP_ENV: "test",
      FLUTTERWAVE_SECRET: "s",
    } as unknown as Env;
    const batch = fakeBatch([
      {
        type: "flutterwave-reconcile",
        daysAgo: 2,
        originalAt: "now",
        attempt: 1,
      },
    ]);
    await handleReconciliationQueue(batch, env);
    expect(
      (batch.messages[0].retry as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(1);
  });
});
