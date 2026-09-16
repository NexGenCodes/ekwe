// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "../EmptyState";

const color = {
  foreground: "#111111",
  muted: "#6b7280",
  brand: "#2563eb",
  warning: "#d97706",
  error: "#dc2626",
  success: "#16a34a",
  shadow: "#000000",
} as const;

vi.mock("@/components/ui", () => {
  const View = ({
    children,
    accessibilityLabel,
    accessibilityRole,
    ...rest
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) => (
    <div
      role={accessibilityRole}
      aria-label={accessibilityLabel ? String(accessibilityLabel) : undefined}
      {...rest}
    >
      {children}
    </div>
  );
  const Text = ({ children, ...rest }: { children?: React.ReactNode }) => (
    <span {...rest}>{children}</span>
  );
  return { Box: View, Text };
});

vi.mock("@/hooks", () => ({
  useTheme: () => ({ color, isDark: false }),
}));

describe("EmptyState", () => {
  it("renders title and subtitle", () => {
    render(
      <EmptyState title="Silent Library" subtitle="History appears here." />,
    );

    expect(screen.getByText("Silent Library")).toBeTruthy();
    expect(screen.getByText("History appears here.")).toBeTruthy();
  });

  it("renders the action slot when provided", () => {
    render(
      <EmptyState
        title="No Matches Found"
        subtitle="Try a different search."
        action={<button type="button">Retry</button>}
      />,
    );

    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("exposes a summary accessibility role with combined label", () => {
    render(<EmptyState title="Empty" subtitle="No items" />);

    expect(
      screen.getByRole("summary", { name: "Empty. No items" }),
    ).toBeTruthy();
  });

  it("uses the title as the accessibility label when there is no subtitle", () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByRole("summary", { name: "Nothing here" })).toBeTruthy();
    expect(screen.queryByText("Empty")).toBeNull();
  });
});
