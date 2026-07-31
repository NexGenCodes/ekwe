import { formatDuration } from "../formatDuration";
import { removeFillerWords } from "../removeFiller";

describe("formatDuration", () => {
  it("returns null for empty, undefined, or null durations", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });

  it("formats seconds under a minute correctly", () => {
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(5)).toBe("0:05");
  });

  it("formats minutes and seconds correctly", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3605)).toBe("60:05");
  });
});

describe("removeFillerWords", () => {
  it("removes filler words from string", () => {
    const fillerWords = ["um", "uh", "like"];
    const text = "hello world";
    const result = removeFillerWords(text, fillerWords);
    expect(result).toBe("hello world");
  });

  it("handles actual filler words", () => {
    const fillerWords = ["um", "uh", "like"];
    const text = "um hello like world uh";
    const result = removeFillerWords(text, fillerWords);
    expect(result).toBe("hello world");
  });

  it("handles empty strings", () => {
    expect(removeFillerWords("", ["um"])).toBe("");
  });
});
