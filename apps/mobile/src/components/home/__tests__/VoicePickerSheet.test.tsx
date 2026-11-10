// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isPro: false,
  badges: 0,
  locked: [] as boolean[],
}));

vi.mock("react-native", () => ({
  ScrollView: ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactElement => <div>{children}</div>,
}));

vi.mock("@legendapp/state/react", () => ({
  useValue: (selector: () => unknown): unknown => selector(),
}));

vi.mock("@/store", () => ({
  auth$: { isPro: { get: (): boolean => state.isPro } },
}));

vi.mock("@/hooks", () => ({
  useTheme: (): { color: Record<string, string> } => ({
    color: {
      brand: "#000000",
      border: "#dddddd",
      card: "#ffffff",
      foreground: "#000000",
      muted: "#999999",
      surface: "#ffffff",
      onBrand: "#ffffff",
    },
  }),
}));

vi.mock("@/components/PaidBadge", () => ({
  PaidBadge: (): React.ReactElement => {
    state.badges += 1;
    return <span data-testid="paid-badge" />;
  },
}));

vi.mock("@/components/LockedPressable", () => ({
  LockedPressable: ({
    locked,
    children,
  }: {
    locked?: boolean;
    children: React.ReactNode;
  }): React.ReactElement => {
    state.locked.push(!!locked);
    return <div>{children}</div>;
  },
}));

vi.mock("@/components/ui", () => ({
  Box: ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <div>{children}</div>
  ),
  Pressable: ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactElement => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <span>{children}</span>
  ),
}));

vi.mock("@/components/ui/Sheet", () => ({
  Sheet: ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/Spinner", () => ({
  Spinner: (): null => null,
}));

vi.mock("@/utils/haptics", () => ({ triggerHaptic: vi.fn() }));

vi.mock("lucide-react-native/icons/audio-lines", () => ({
  default: (): null => null,
}));
vi.mock("lucide-react-native/icons/check", () => ({
  default: (): null => null,
}));
vi.mock("lucide-react-native/icons/pause", () => ({
  default: (): null => null,
}));
vi.mock("lucide-react-native/icons/play", () => ({
  default: (): null => null,
}));
vi.mock("lucide-react-native/icons/mars", () => ({
  default: (): null => null,
}));
vi.mock("lucide-react-native/icons/venus", () => ({
  default: (): null => null,
}));

import { VoicePickerSheet } from "@/components/home/VoicePickerSheet";

const renderSheet = (): void => {
  render(
    <VoicePickerSheet
      visible
      onClose={() => {}}
      currentVoiceId={null}
      onSelect={() => {}}
    />,
  );
};

describe("VoicePickerSheet paid badge", () => {
  beforeEach(() => {
    state.isPro = false;
    state.badges = 0;
    state.locked.length = 0;
  });

  it("locks pro voices and shows the paid badge for free users", () => {
    renderSheet();

    // Standard (free), Studio · Clear (pro), Studio · Warm (pro).
    expect(state.locked).toEqual([false, true, true]);
    expect(state.badges).toBe(2);
  });

  it("does not lock or badge pro voices for paid users", () => {
    state.isPro = true;
    renderSheet();

    expect(state.locked).toEqual([false, false, false]);
    expect(state.badges).toBe(0);
  });
});
