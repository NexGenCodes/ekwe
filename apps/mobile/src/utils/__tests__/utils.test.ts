import { formatClock, formatDuration } from "@/utils/formatDuration";
import { removeFillerWords } from "@/utils/removeFiller";
import {
  isGenuineLanguageDetection,
  resolveDetectedLanguage,
} from "@/utils/languageUtils";

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
  });

  it("rolls into hours once the duration passes an hour", () => {
    expect(formatDuration(3599)).toBe("59:59");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3605)).toBe("1:00:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
});

describe("formatClock", () => {
  it("always renders a clock, clamping zero and negatives to 0:00", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(null)).toBe("0:00");
    expect(formatClock(undefined)).toBe("0:00");
  });

  it("uses the same m:ss / h:mm:ss convention as formatDuration", () => {
    expect(formatClock(7)).toBe("0:07");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3605)).toBe("1:00:05");
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

  it("never returns null for auto-detect so the Detected pill always shows for paid users", () => {
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
