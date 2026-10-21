import { beforeEach, describe, expect, test, vi } from "vitest";
import { mockEnv } from "@/__tests__/setup";
import { logger } from "@/core/logger";
import {
  HEALTH_TRIP_THRESHOLD,
  isProviderDegraded,
  reportProviderNeutral,
  reportProviderOutcome,
  resetHealthMemo,
} from "@/services/health";

describe("health circuit breaker", () => {
  beforeEach(() => {
    resetHealthMemo();
  });

  test("starts healthy", async () => {
    const env = mockEnv();
    expect(await isProviderDegraded(env, "groq")).toBe(false);
  });

  test("does not trip below the failure threshold", async () => {
    const env = mockEnv();
    await reportProviderOutcome(env, "groq", false);
    await reportProviderOutcome(env, "groq", false);
    expect(await isProviderDegraded(env, "groq")).toBe(false);
  });

  test("trips open after consecutive failures and skips while open", async () => {
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD; i++) {
      await reportProviderOutcome(env, "groq", false);
    }
    expect(await isProviderDegraded(env, "groq")).toBe(true);
    expect(await isProviderDegraded(env, "groq")).toBe(true);
  });

  test("a single success closes an open circuit", async () => {
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD; i++) {
      await reportProviderOutcome(env, "groq", false);
    }
    expect(await isProviderDegraded(env, "groq")).toBe(true);

    await reportProviderOutcome(env, "groq", true);
    expect(await isProviderDegraded(env, "groq")).toBe(false);
  });

  test("logs a warning, not a Sentry error, when the breaker trips open", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const errorSpy = vi.spyOn(logger, "error");
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD; i++) {
      await reportProviderOutcome(env, "gladia", false);
    }
    expect(await isProviderDegraded(env, "gladia")).toBe(true);

    const alerts = warnSpy.mock.calls.filter(([msg]) =>
      String(msg).includes("[health]"),
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0]![0]).toContain('"gladia" tripped open');
    expect(alerts[0]![1]).toMatchObject({ failures: HEALTH_TRIP_THRESHOLD });
    expect(
      errorSpy.mock.calls.filter(([msg]) => String(msg).includes("[health]")),
    ).toHaveLength(0);
  });

  test("keeps providers independent", async () => {
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD; i++) {
      await reportProviderOutcome(env, "groq", false);
    }
    expect(await isProviderDegraded(env, "groq")).toBe(true);
    expect(await isProviderDegraded(env, "deepgram")).toBe(false);
  });

  test("recovers after a failure sequence once the breaker sees success", async () => {
    const env = mockEnv();
    await reportProviderOutcome(env, "cohere", false);
    await reportProviderOutcome(env, "cohere", true);
    await reportProviderOutcome(env, "cohere", false);
    await reportProviderOutcome(env, "cohere", false);
    expect(await isProviderDegraded(env, "cohere")).toBe(false);
  });

  test("a null result does not count as a provider failure", async () => {
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD * 2; i++) {
      reportProviderNeutral("deepgram");
    }
    expect(await isProviderDegraded(env, "deepgram")).toBe(false);
  });

  test("a null result neither trips nor clears an existing failure count", async () => {
    const env = mockEnv();
    await reportProviderOutcome(env, "witai", false);
    await reportProviderOutcome(env, "witai", false);
    reportProviderNeutral("witai");
    reportProviderNeutral("witai");
    await reportProviderOutcome(env, "witai", false);
    expect(await isProviderDegraded(env, "witai")).toBe(true);
  });

  test("counts failures that land on separate isolates", async () => {
    const env = mockEnv();
    for (let i = 0; i < HEALTH_TRIP_THRESHOLD - 1; i++) {
      await reportProviderOutcome(env, "assemblyai", false);
      resetHealthMemo();
    }
    await reportProviderOutcome(env, "assemblyai", false);
    expect(await isProviderDegraded(env, "assemblyai")).toBe(true);
  });
});
