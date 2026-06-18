import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("returns null for undefined", () => {
    expect(formatDuration(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(formatDuration(null)).toBeNull();
  });

  it("returns null for 0", () => {
    expect(formatDuration(0)).toBeNull();
  });

  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("pads seconds with leading zero", () => {
    expect(formatDuration(63)).toBe("1:03");
  });

  it("handles large durations", () => {
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("handles exactly 1 minute", () => {
    expect(formatDuration(60)).toBe("1:00");
  });

  it("handles fractional seconds by flooring", () => {
    expect(formatDuration(90.7)).toBe("1:30");
  });
});
