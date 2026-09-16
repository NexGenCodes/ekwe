// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { QuotaUsageCard } from "../QuotaUsageCard";

const color = {
  foreground: "#111111",
  muted: "#6b7280",
  brand: "#2563eb",
  warning: "#d97706",
  error: "#dc2626",
  success: "#16a34a",
  shadow: "#000000",
} as const;

const usage = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/hooks", () => ({
  useTheme: () => ({ color, isDark: false }),
}));

vi.mock("@/hooks/queries/useUsageQuery", () => ({
  useUsageQuery: () => usage.query(),
}));

vi.mock("@/components/ui", () => {
  const View = ({
    children,
    accessibilityLabel,
    accessibilityRole,
    accessibilityValue,
    style: _style,
    ...rest
  }: {
    children?: React.ReactNode;
    style?: unknown;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityValue?: { min: number; max: number; now: number };
  }) => (
    <div
      role={accessibilityRole}
      aria-label={accessibilityLabel ? String(accessibilityLabel) : undefined}
      aria-valuemin={accessibilityValue?.min}
      aria-valuemax={accessibilityValue?.max}
      aria-valuenow={accessibilityValue?.now}
      {...rest}
    >
      {children}
    </div>
  );
  const Text = ({
    children,
    style: _style,
    ...rest
  }: {
    children?: React.ReactNode;
    style?: unknown;
  }) => <span {...rest}>{children}</span>;
  const Spinner = () => <span role="status" aria-label="Loading" />;
  return { Box: View, Text, Spinner };
});

vi.mock("@/components/Card", () => ({
  Card: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

vi.mock("lucide-react-native/icons/activity", () => ({
  default: () => null,
}));

const fiveHoursAhead = Date.now() + 5 * 3600 * 1000;

function healthyData() {
  return {
    day: "2026-09-12",
    resetsAt: fiveHoursAhead,
    translate: { used: 3, total: 25, remaining: 22 },
    transcribe: { used: 10, total: 25, remaining: 15 },
    tts: { used: 40, total: 5000, remaining: 4960 },
  };
}

function renderCard() {
  return render(<QuotaUsageCard />);
}

describe("QuotaUsageCard", () => {
  it("shows the header and a spinner while loading", () => {
    usage.query.mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
    });

    renderCard();

    expect(screen.getByText("Today's usage")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("surfaces the error state when the usage query fails", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
    });

    renderCard();

    expect(
      screen.getByText("Usage could not be loaded right now."),
    ).toBeTruthy();
  });

  it("renders both pools with remaining counts and the reset label", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: healthyData(),
    });

    renderCard();

    expect(screen.getByText("Translations")).toBeTruthy();
    expect(screen.getByText("3 / 25 used · 22 left")).toBeTruthy();
    expect(screen.getByText("Transcriptions")).toBeTruthy();
    expect(screen.getByText("10 / 25 used · 15 left")).toBeTruthy();
    expect(screen.getByText("Resets in 5h")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: "Translations: 3 of 25 used today",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: "Transcriptions: 10 of 25 used today",
      }),
    ).toBeTruthy();
  });

  it("flags the headline when a pool is fully exhausted", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        ...healthyData(),
        translate: { used: 25, total: 25, remaining: 0 },
      },
    });

    renderCard();

    expect(screen.getByText("Daily limit reached")).toBeTruthy();
    expect(screen.getByText("25 / 25 used · 0 left")).toBeTruthy();
  });

  it("flags the headline when a pool is nearly exhausted", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        ...healthyData(),
        translate: { used: 24, total: 25, remaining: 1 },
      },
    });

    renderCard();

    expect(screen.getByText("Almost out for today")).toBeTruthy();
  });

  it("renders unlimited pools without a remainder meter", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        ...healthyData(),
        translate: { used: 0, total: 0, remaining: 0 },
        transcribe: { used: 0, total: 0, remaining: 0 },
      },
    });

    renderCard();

    expect(screen.getAllByText("Unlimited")).toHaveLength(2);
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("falls back to the midnight label when the reset time has passed", () => {
    usage.query.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { ...healthyData(), resetsAt: Date.now() - 1000 },
    });

    renderCard();

    expect(screen.getByText("Resets at midnight")).toBeTruthy();
  });
});
