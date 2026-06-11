import { render, screen } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { IconContainer } from "../IconContainer";

jest.mock("@/hooks", () => ({
  useTheme: () => ({
    color: {
      primary: "#007AFF",
      muted: "#8E8E93",
    },
  }),
}));

describe("IconContainer", () => {
  it("renders children", () => {
    render(
      <IconContainer>
        <Text testID="child">A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("child")).toBeOnTheScreen();
  });

  it("maps size presets to pixel dimensions", () => {
    const { rerender } = render(
      <IconContainer size="sm" testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ width: 36, height: 36 });

    rerender(
      <IconContainer size="md" testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ width: 40, height: 40 });

    rerender(
      <IconContainer size="lg" testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ width: 48, height: 48 });

    rerender(
      <IconContainer size="xl" testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ width: 64, height: 64 });
  });

  it("accepts custom numeric size", () => {
    render(
      <IconContainer size={100} testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ width: 100, height: 100 });
  });

  it("uses full rounded style by default", () => {
    render(
      <IconContainer testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ borderRadius: 20 });
  });

  it("applies custom style", () => {
    render(
      <IconContainer style={{ marginTop: 5 }} testID="icon">
        <Text>A</Text>
      </IconContainer>,
    );
    expect(screen.getByTestId("icon")).toHaveStyle({ marginTop: 5 });
  });
});
