// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/mmkvPlugin", async () => {
  const { configureObservableSync } = await import("@legendapp/state/sync");

  const tables = new Map<string, unknown>();
  const mmkvPlugin = {
    loadTable: (table: string): Promise<void> => {
      if (!tables.has(table)) tables.set(table, {});
      return Promise.resolve();
    },
    getTable: <T>(table: string, init: object): T =>
      (tables.get(table) ?? init) as T,
    getMetadata: (): Record<string, never> => ({}),
    set: (): void => {},
    setMetadata: (): Promise<void> => Promise.resolve(),
    deleteTable: (table: string): void => {
      tables.delete(table);
    },
    deleteMetadata: (): void => {},
  };

  configureObservableSync({ persist: { plugin: mmkvPlugin } });

  return { mmkvPlugin };
});

vi.mock("@/services/usage", () => ({ fetchUsage: vi.fn() }));

import type { UsageSnapshot } from "@ekwe/shared";
import { usage$ } from "@/hooks/queries/useUsageQuery";
import {
  isQuotaExhausted,
  quotaRemaining,
  quotaResetLabel,
} from "@/utils/quota";

const HOUR = 3_600_000;

function snapshot(
  remaining: { translate: number; transcribe: number; speech: number },
  overrides: Partial<UsageSnapshot> = {},
): UsageSnapshot {
  const totals = { translate: 600, transcribe: 60, speech: 60_000 };
  const used = {
    translate: totals.translate - remaining.translate,
    transcribe: totals.transcribe - remaining.transcribe,
    speech: totals.speech - remaining.speech,
  };
  return {
    day: "2026-10-22",
    resetsAt: Date.now() + 2 * HOUR,
    month: "2026-10",
    monthResetsAt: Date.now() + 9 * 24 * HOUR,
    meters: [
      {
        id: "translate",
        label: "Translation",
        unit: "requests",
        used: used.translate,
        total: totals.translate,
        remaining: remaining.translate,
      },
      {
        id: "transcribe",
        label: "Transcription",
        unit: "min",
        used: used.transcribe,
        total: totals.transcribe,
        remaining: remaining.transcribe,
      },
      {
        id: "speech",
        label: "Speech",
        unit: "chars",
        used: used.speech,
        total: totals.speech,
        remaining: remaining.speech,
      },
      {
        id: "budget",
        label: "Shared AI budget",
        unit: "credits",
        used: 0,
        total: 1_300,
        remaining: 1_300,
      },
    ],
    ...overrides,
  };
}

describe("quota helpers", () => {
  beforeEach(() => {
    usage$.set(undefined);
  });

  it("reports nothing when no snapshot is cached", () => {
    expect(quotaRemaining("translate")).toBeNull();
    expect(isQuotaExhausted("translate")).toBe(false);
  });

  it("flags a meter that has spent its monthly cap", () => {
    usage$.set(snapshot({ translate: 0, transcribe: 4, speech: 10 }));

    expect(isQuotaExhausted("translate")).toBe(true);
    expect(isQuotaExhausted("transcribe")).toBe(false);
    expect(quotaRemaining("speech")).toBe(10);
  });

  it("ignores a snapshot from a month that has already reset", () => {
    usage$.set(
      snapshot(
        { translate: 0, transcribe: 0, speech: 0 },
        { resetsAt: Date.now() - 1 },
      ),
    );

    expect(isQuotaExhausted("translate")).toBe(false);
    expect(quotaRemaining("speech")).toBeNull();
    expect(quotaResetLabel()).toBe("next month");
  });

  it("treats an unlimited meter as unknown rather than exhausted", () => {
    const unlimited = snapshot({ translate: 0, transcribe: 0, speech: 0 });
    unlimited.meters = unlimited.meters.map((meter) => ({
      ...meter,
      total: null,
      remaining: null,
    }));
    usage$.set(unlimited);

    expect(quotaRemaining("translate")).toBeNull();
    expect(isQuotaExhausted("translate")).toBe(false);
  });

  it("treats a zero-cap meter as unavailable", () => {
    const unavailable = snapshot({ translate: 0, transcribe: 0, speech: 0 });
    unavailable.meters = unavailable.meters.map((meter) => ({
      ...meter,
      total: 0,
      remaining: 0,
    }));
    usage$.set(unavailable);

    expect(quotaRemaining("translate")).toBe(0);
    expect(isQuotaExhausted("translate")).toBe(true);
  });
});
