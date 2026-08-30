import { render, screen } from "@testing-library/react-native";
import React from "react";

import { QuotaUsageCard } from "../QuotaUsageCard";

jest.mock("@/hooks", () => ({
  useTheme: () => mockTheme(),
}));

jest.mock("@/hooks/ui/useTheme", () => ({
  useTheme: () => mockTheme(),
}));

jest.mock("@/hooks/queries/useUsageQuery", () => ({
  useUsageQuery: () => mockUsageQuery,
  invalidateUsage: jest.fn(),
  usageQueryKey: ["usage"],
}));

import { lightColors } from "@ekwe/shared";

import type { UsageSnapshot } from "@/services/usage";

function mockTheme() {
  const color = { ...lightColors } as typeof lightColors;
  return {
    colorScheme: "light",
    setColorScheme: jest.fn(),
    isDark: false,
    color: {
      ...color,
      bubble: {
        idle: color.foreground,
        recording: color.error,
        processing: color.warning,
        done: color.success,
        error: color.error,
      },
    },
    shadow: {
      overlay: {
        shadowColor: color.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 8,
      },
    },
  };
}

let mockUsageQuery: {
  data: UsageSnapshot | null;
  isLoading: boolean;
  isError: boolean;
};

const healthySnapshot: UsageSnapshot = {
  day: "2026-08-12",
  resetsAt: Date.now() + 5 * 3_600_000,
  translate: { used: 10, total: 25, remaining: 15 },
  transcribe: { used: 5, total: 25, remaining: 20 },
  tts: { used: 40, total: 5000, remaining: 4960 },
};

const nearLimitSnapshot: UsageSnapshot = {
  day: "2026-08-12",
  resetsAt: Date.now() + 5 * 3_600_000,
  translate: { used: 24, total: 25, remaining: 1 },
  transcribe: { used: 0, total: 25, remaining: 25 },
  tts: { used: 100, total: 5000, remaining: 4900 },
};

const exhaustedSnapshot: UsageSnapshot = {
  day: "2026-08-12",
  resetsAt: Date.now() + 5 * 3_600_000,
  translate: { used: 25, total: 25, remaining: 0 },
  transcribe: { used: 25, total: 25, remaining: 0 },
  tts: { used: 5000, total: 5000, remaining: 0 },
};

const unlimitedSnapshot: UsageSnapshot = {
  day: "2026-08-12",
  resetsAt: Date.now() + 5 * 3_600_000,
  translate: { used: 10, total: 0, remaining: 0 },
  transcribe: { used: 5, total: 0, remaining: 0 },
  tts: { used: 0, total: 0, remaining: 0 },
};

describe("QuotaUsageCard", () => {
  beforeEach(() => {
    mockUsageQuery = {
      data: healthySnapshot,
      isLoading: false,
      isError: false,
    };
  });

  it("renders the daily usage title and both pool meters", async () => {
    await render(<QuotaUsageCard />);

    expect(screen.getByText("Today's usage")).toBeOnTheScreen();
    expect(screen.getByText("Translations")).toBeOnTheScreen();
    expect(screen.getByText("Transcriptions")).toBeOnTheScreen();
    expect(screen.getByText("10 / 25 used · 15 left")).toBeOnTheScreen();
    expect(screen.getByText("5 / 25 used · 20 left")).toBeOnTheScreen();
  });

  it("exposes accessible progressbar roles with used/total values", async () => {
    await render(<QuotaUsageCard />);

    expect(
      screen.getByLabelText("Translations: 10 of 25 used today"),
    ).toHaveAccessibleName("Translations: 10 of 25 used today");
    expect(
      screen.getByLabelText("Transcriptions: 5 of 25 used today"),
    ).toHaveAccessibleName("Transcriptions: 5 of 25 used today");
  });

  it("shows a reset countdown when pools are healthy", async () => {
    await render(<QuotaUsageCard />);

    expect(screen.getByText("Resets in 5h")).toBeOnTheScreen();
  });

  it("shows a warning headline when a pool is almost exhausted", async () => {
    mockUsageQuery = {
      data: nearLimitSnapshot,
      isLoading: false,
      isError: false,
    };

    await render(<QuotaUsageCard />);

    expect(screen.getByText("Almost out for today")).toBeOnTheScreen();
  });

  it("shows an error headline when a pool is fully exhausted", async () => {
    mockUsageQuery = {
      data: exhaustedSnapshot,
      isLoading: false,
      isError: false,
    };

    await render(<QuotaUsageCard />);

    expect(screen.getByText("Daily limit reached")).toBeOnTheScreen();
  });

  it("renders 'Unlimited' rows when a plan has no cap", async () => {
    mockUsageQuery = {
      data: unlimitedSnapshot,
      isLoading: false,
      isError: false,
    };

    await render(<QuotaUsageCard />);

    expect(screen.getAllByText("Unlimited")).toHaveLength(2);
    expect(screen.queryByText("Daily limit reached")).not.toBeOnTheScreen();
  });

  it("degrades gracefully on load error", async () => {
    mockUsageQuery = { data: null, isLoading: false, isError: true };

    await render(<QuotaUsageCard />);

    expect(
      screen.getByText("Usage could not be loaded right now."),
    ).toBeOnTheScreen();
  });

  it("renders without crashing while loading", async () => {
    mockUsageQuery = { data: null, isLoading: true, isError: false };

    await render(<QuotaUsageCard />);

    expect(screen.getByText("Today's usage")).toBeOnTheScreen();
  });
});
