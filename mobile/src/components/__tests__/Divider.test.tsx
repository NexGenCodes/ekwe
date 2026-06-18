import { render, screen } from "@testing-library/react-native";
import React from "react";

import { Divider } from "../Divider";

jest.mock("@/hooks", () => ({
  useTheme: () => ({
    color: {
      primary: "#007AFF",
      muted: "#8E8E93",
      border: "#C6C6C8",
    },
  }),
}));

jest.mock("@/hooks/ui/useTokens", () => ({
  useTokens: () => ({
    color: { foreground: "#000000" },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  }),
}));

describe("Divider", () => {
  it("renders a horizontal line", () => {
    render(<Divider />);
    const container = screen.getByTestId("divider-container");
    expect(container).toBeOnTheScreen();
  });

  it("renders the label when provided", () => {
    render(<Divider label="OR" />);
    expect(screen.getByText("OR")).toBeOnTheScreen();
  });

  it("does not render label when omitted", () => {
    render(<Divider />);
    expect(screen.queryByText("OR")).not.toBeOnTheScreen();
  });

  it("applies custom style", () => {
    render(<Divider style={{ marginVertical: 10 }} />);
    const container = screen.getByTestId("divider-container");
    expect(container).toHaveStyle({ marginVertical: 10 });
  });
});
