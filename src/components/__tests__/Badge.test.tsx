import { render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { Badge } from "../Badge";

jest.mock("@/hooks", () => ({
  useTheme: () => ({
    color: {
      primary: "#007AFF",
      muted: "#8E8E93",
      warning: "#FF9500",
      error: "#FF3B30",
      success: "#34C759",
      border: "#C6C6C8",
    },
  }),
}));

jest.mock("@/hooks/ui/useTokens", () => ({
  useTokens: () => ({
    color: { foreground: "#000000" },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
    borderRadius: {
      none: 0,
      sm: 4,
      md: 8,
      lg: 12,
      xl: 16,
      "2xl": 24,
      full: 9999,
    },
  }),
}));

describe("Badge", () => {
  it("renders the label text", () => {
    render(<Badge label="PRO" />);
    expect(screen.getByText("PRO")).toBeOnTheScreen();
  });

  it("renders with uppercase text transform", () => {
    render(<Badge label="free" />);
    const text = screen.getByText("free");
    expect(text).toHaveStyle({ textTransform: "uppercase" });
  });

  it("renders with optional icon", () => {
    render(<Badge label="PRO" icon={<Text testID="icon-star">*</Text>} />);
    expect(screen.getByTestId("icon-star")).toBeOnTheScreen();
  });

  it("uses caption variant for sm size", () => {
    render(<Badge label="SM" size="sm" />);
    const text = screen.getByText("SM");
    expect(text).toBeOnTheScreen();
  });

  it("uses bodySmall variant for md size", () => {
    render(<Badge label="MD" size="md" />);
    const text = screen.getByText("MD");
    expect(text).toBeOnTheScreen();
  });

  it("applies custom style", () => {
    render(<Badge label="PRO" style={{ marginTop: 10 }} testID="badge" />);
    const container = screen.getByTestId("badge");
    expect(container).toHaveStyle({ marginTop: 10 });
  });
});
