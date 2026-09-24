import { getRelativeTime } from "@/utils/relativeTime";

describe("getRelativeTime", () => {
  const now = Date.now();

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns Just now for < 1 min", () => {
    expect(getRelativeTime(now - 30 * 1000)).toBe("Just now");
  });

  it("returns Xm ago for minutes", () => {
    expect(getRelativeTime(now - 5 * 60 * 1000)).toBe("5m ago");
    expect(getRelativeTime(now - 59 * 60 * 1000)).toBe("59m ago");
  });

  it("returns Xh ago for hours", () => {
    expect(getRelativeTime(now - 2 * 60 * 60 * 1000)).toBe("2h ago");
    expect(getRelativeTime(now - 23 * 60 * 60 * 1000)).toBe("23h ago");
  });

  it("returns Yesterday for 1 day", () => {
    expect(getRelativeTime(now - 24 * 60 * 60 * 1000)).toBe("Yesterday");
    expect(getRelativeTime(now - 47 * 60 * 60 * 1000)).toBe("Yesterday");
  });

  it("returns locale date string for > 1 day", () => {
    const timestamp = now - 3 * 24 * 60 * 60 * 1000;
    const dateStr = new Date(timestamp).toLocaleDateString();
    expect(getRelativeTime(timestamp)).toBe(dateStr);
  });
});
