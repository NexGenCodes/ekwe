import { formatDuration } from "../formatDuration";
import { removeFillerWords } from "../removeFiller";
import {
  isGenuineLanguageDetection,
  resolveDetectedLanguage,
} from "../languageUtils";

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

describe("resolveDetectedLanguage", () => {
  it("returns the provider report when auto-detect was requested", () => {
    expect(resolveDetectedLanguage("es", "auto", "en")).toBe("es");
  });

  it("never returns null for auto-detect so the Detected pill always shows for Pro users", () => {
    expect(resolveDetectedLanguage(null, "auto", "en")).toBe("en");
    expect(resolveDetectedLanguage(undefined, "auto", "en")).toBe("en");
    expect(resolveDetectedLanguage("und", "auto", "en")).toBe("en");
  });

  it("treats a reported language different from the source as a genuine detection", () => {
    expect(resolveDetectedLanguage("fr", "en", "en")).toBe("fr");
  });

  it("falls back to the explicit source when the provider echoes it back", () => {
    expect(resolveDetectedLanguage("en", "en", "en")).toBe("en");
  });
});

describe("isGenuineLanguageDetection", () => {
  it("is true when auto-detect reports a concrete language", () => {
    expect(isGenuineLanguageDetection("es", "auto")).toBe(true);
  });

  it("is false when nothing was detected or the report matches the request", () => {
    expect(isGenuineLanguageDetection(null, "auto")).toBe(false);
    expect(isGenuineLanguageDetection("und", "auto")).toBe(false);
    expect(isGenuineLanguageDetection("en", "en")).toBe(false);
  });
});
