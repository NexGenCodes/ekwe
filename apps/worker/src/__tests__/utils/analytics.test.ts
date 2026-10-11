import { describe, test, expect, vi } from "vitest";
import { mockEnv, mockSignal } from "@/__tests__/setup";
import {
  AE_LAYOUT,
  recordEvent,
  recordProviderAttempt,
  recordRequestEvent,
  recordUserEvent,
} from "@/utils/analytics";
import { runProviderFailover } from "@/utils/retry";

function aeCalls(env: ReturnType<typeof mockEnv>) {
  return vi
    .mocked(env.EKWE_ANALYTICS!.writeDataPoint)
    .mock.calls.map(([event]) => event);
}

function blobAt(event: unknown, slot: number) {
  const e = event as { blobs?: ((string | ArrayBuffer) | null)[] };
  return e.blobs?.[slot] ?? undefined;
}

describe("analytics events (utils/analytics.ts)", () => {
  test("recordEvent no-ops when the binding is absent", () => {
    const env = mockEnv({ EKWE_ANALYTICS: undefined });
    expect(() =>
      recordEvent(env, { index: "x", eventType: "x", outcome: "ok" }),
    ).not.toThrow();
  });

  test("recordEvent writes a datapoint with the positional layout", () => {
    const env = mockEnv();
    recordEvent(env, {
      index: "speech_cache:speech_cache",
      eventType: "speech_cache",
      outcome: "hit",
      source: "kv",
      latencyMs: 12,
    });
    const event = aeCalls(env)[0];
    expect(event!.indexes).toEqual(["speech_cache:speech_cache"]);
    expect(event!.blobs).toEqual([
      "v1",
      "speech_cache",
      "hit",
      "",
      "",
      "",
      "",
      "",
      "kv",
      "",
      "",
    ]);
    expect(event!.doubles).toEqual([12, 0]);
  });

  test("recordUserEvent stores a SHA-256 hash, never the raw id", async () => {
    const env = mockEnv();
    await recordUserEvent(env, "usage", "user-123", "ok", "translate");
    const event = aeCalls(env)[0];
    expect(event!.indexes).toEqual(["usage:usage"]);
    const user = blobAt(event, AE_LAYOUT.BLOB_USER);
    expect(user).toBeDefined();
    expect(String(user)).not.toContain("user-123");
    expect(String(user)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("recordProviderAttempt exposes provider latency and tier", async () => {
    const env = mockEnv();
    recordProviderAttempt(
      env,
      "speech",
      "gemini",
      "success",
      42,
      "",
      1,
      "FREE",
    );
    const event = aeCalls(env)[0];
    expect(event!.indexes).toEqual(["speech:gemini"]);
    expect(blobAt(event, AE_LAYOUT.BLOB_OUTCOME)).toBe("success");
    expect(blobAt(event, AE_LAYOUT.BLOB_TIER)).toBe("FREE");
    expect(event!.doubles).toEqual([42, 1]);
  });

  test("recordRequestEvent writes status and success/error outcome", async () => {
    const env = mockEnv();
    recordRequestEvent(env, "/usage", 200, 31, "FREE");
    const event = aeCalls(env)[0];
    expect(event!.indexes).toEqual(["/usage:/usage"]);
    expect(blobAt(event, AE_LAYOUT.BLOB_EVENT_TYPE)).toBe("request");
    expect(blobAt(event, AE_LAYOUT.BLOB_OUTCOME)).toBe("success");
    expect(blobAt(event, AE_LAYOUT.BLOB_TIER)).toBe("FREE");
    expect(blobAt(event, AE_LAYOUT.BLOB_HTTP_STATUS)).toBe("200");
    expect(event!.doubles![0]).toBe(31);
  });

  test("recordRequestEvent marks >=500 responses as errors", async () => {
    const env = mockEnv();
    recordRequestEvent(env, "/translate", 502, 80);
    const event = aeCalls(env)[0];
    expect(blobAt(event, AE_LAYOUT.BLOB_OUTCOME)).toBe("error");
    expect(blobAt(event, AE_LAYOUT.BLOB_HTTP_STATUS)).toBe("502");
  });
});

describe("failover telemetry (utils/retry.ts)", () => {
  test("emits a success event for the winning provider", async () => {
    const env = mockEnv();
    const result = await runProviderFailover<string>({
      providers: ["p1"],
      signal: mockSignal(),
      totalMs: 5_000,
      route: "transcribe",
      env,
      tier: "FREE",
      invoke: async () => "ok",
      handleAttempt: async () => true,
    });
    expect(result).toBe("ok");

    const events = aeCalls(env);
    const success = events.find(
      (e) => blobAt(e, AE_LAYOUT.BLOB_OUTCOME) === "success",
    );
    expect(success).toBeDefined();
    expect(success!.indexes).toEqual(["transcribe:p1"]);
    expect(blobAt(success, AE_LAYOUT.BLOB_TIER)).toBe("FREE");
    expect(success!.doubles![0]).toBeGreaterThanOrEqual(0);
    expect(success!.doubles![1]).toBe(1);
  });

  test("emits skip + failure events across providers", async () => {
    const env = mockEnv();
    const result = await runProviderFailover<string>({
      providers: ["p1", "p2"],
      signal: mockSignal(),
      totalMs: 5_000,
      route: "translate",
      env,
      tier: "PREMIUM",
      shouldSkip: async (name) => (name === "p1" ? "circuit-open" : null),
      invoke: async () => {
        throw new Error("upstream timeout");
      },
      handleAttempt: async () => false,
    });
    expect(result).toBeNull();

    const events = aeCalls(env);
    expect(
      events.find(
        (e) =>
          blobAt(e, AE_LAYOUT.BLOB_OUTCOME) === "skip" &&
          e?.indexes?.[0] === "translate:p1",
      ),
    ).toBeDefined();
    expect(
      events.find(
        (e) =>
          blobAt(e, AE_LAYOUT.BLOB_OUTCOME) === "failure" &&
          blobAt(e, AE_LAYOUT.BLOB_ERROR_CLASS) === "timeout" &&
          e?.indexes?.[0] === "translate:p2",
      ),
    ).toBeDefined();
    expect(
      events.some((e) => blobAt(e, AE_LAYOUT.BLOB_OUTCOME) === "success"),
    ).toBe(false);
  });

  test("never emits telemetry when env is not supplied", async () => {
    const env = mockEnv();
    await runProviderFailover<string>({
      providers: ["p1"],
      signal: mockSignal(),
      totalMs: 5_000,
      route: "speech",
      invoke: async () => "ok",
      handleAttempt: async () => true,
    });
    expect(env.EKWE_ANALYTICS!.writeDataPoint).not.toHaveBeenCalled();
  });
});
