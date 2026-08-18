import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import React from "react";

import { lightColors } from "@ekwe/shared";

import { EmptyState } from "../EmptyState";

jest.mock("@/hooks/ui/useTheme", () => ({
  useTheme: () => mockTheme(),
}));

jest.mock("@/hooks", () => ({
  useTheme: () => mockTheme(),
}));

const color = { ...lightColors } as typeof lightColors;

function mockTheme() {
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

describe("EmptyState", () => {
  it("renders title and subtitle", async () => {
    await render(
      <EmptyState title="Silent Library" subtitle="History appears here." />,
    );

    expect(screen.getByText("Silent Library")).toBeOnTheScreen();
    expect(screen.getByText("History appears here.")).toBeOnTheScreen();
  });

  it("renders the action slot when provided", async () => {
    await render(
      <EmptyState
        title="No Matches Found"
        subtitle="Try a different search."
        action={<Text>Retry</Text>}
      />,
    );

    expect(screen.getByText("Retry")).toBeOnTheScreen();
  });

  it("exposes a summary accessibility role with combined label", async () => {
    await render(<EmptyState title="Empty" subtitle="No items" />);

    expect(screen.getByLabelText("Empty. No items")).toBeOnTheScreen();
  });

  it("omits the subtitle text node when not provided", async () => {
    await render(<EmptyState title="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeOnTheScreen();
    expect(screen.queryByText("Empty")).toBeNull();
  });
});
