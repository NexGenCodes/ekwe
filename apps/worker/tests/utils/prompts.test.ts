import { describe, expect, test } from "vitest";
import {
  buildTranslatePrompt,
  isHallucination,
  needsRomanization,
  parseTranslateOutput,
  ROMANIZATION_MARKER,
} from "../../src/utils/prompts";

describe("needsRomanization", () => {
  test("true for non-Latin script targets", () => {
    for (const code of ["hi", "ar", "ru", "zh", "ja", "ko", "he", "th"]) {
      expect(needsRomanization(code)).toBe(true);
    }
  });

  test("false for Latin script targets and unknown codes", () => {
    for (const code of ["yo", "fr", "es", "sw", "en", "zz"]) {
      expect(needsRomanization(code)).toBe(false);
    }
  });
});

describe("buildTranslatePrompt", () => {
  test("does not mention romanization unless requested", () => {
    const prompt = buildTranslatePrompt("Yoruba", "English");
    expect(prompt).toContain("Output ONLY the final translated text");
    expect(prompt).not.toContain(ROMANIZATION_MARKER);
  });

  test("adds the marker format rule when requested", () => {
    const prompt = buildTranslatePrompt("Hindi", "English", true);
    expect(prompt).toContain(ROMANIZATION_MARKER);
    expect(prompt).not.toContain("Output ONLY the final translated text");
  });
});

describe("parseTranslateOutput", () => {
  test("passthrough when transliteration was not requested", () => {
    expect(parseTranslateOutput("  Hola mundo  ", false)).toEqual({
      translation: "Hola mundo",
    });
    // Even a stray marker is left alone: the prompt never asked for one.
    expect(
      parseTranslateOutput(`Hola${ROMANIZATION_MARKER}\nO-la`, false),
    ).toEqual({
      translation: `Hola${ROMANIZATION_MARKER}\nO-la`,
    });
  });

  test("splits translation and romanization when requested", () => {
    expect(
      parseTranslateOutput(`नमस्ते\n${ROMANIZATION_MARKER}\nNamaste`, true),
    ).toEqual({ translation: "नमस्ते", transliteration: "Namaste" });
  });

  test("falls back to the raw text when the marker is absent", () => {
    expect(parseTranslateOutput("नमस्ते", true)).toEqual({
      translation: "नमस्ते",
    });
  });

  test("falls back to the raw text when romanization is empty", () => {
    expect(
      parseTranslateOutput(`नमस्ते\n${ROMANIZATION_MARKER}\n  `, true),
    ).toEqual({ translation: "नमस्ते" });
  });
});

describe("isHallucination", () => {
  test("empty text is hallucination", () => {
    expect(isHallucination("")).toBe(true);
    expect(isHallucination("   ")).toBe(true);
  });

  test('"thanks for watching" pattern', () => {
    expect(isHallucination("Thanks for watching")).toBe(true);
    expect(isHallucination("thank you for watching")).toBe(true);
  });

  test("subscribe pattern", () => {
    expect(isHallucination("Please subscribe")).toBe(true);
    expect(isHallucination("like and subscribe")).toBe(true);
  });

  test("bracket patterns", () => {
    expect(isHallucination("[Music]")).toBe(true);
    expect(isHallucination("[Applause]")).toBe(true);
  });

  test("single pronoun/article", () => {
    expect(isHallucination("you")).toBe(true);
    expect(isHallucination("the")).toBe(true);
    expect(isHallucination("i")).toBe(true);
  });

  test("repeated phrase", () => {
    expect(isHallucination("abcdeabcdeabcde")).toBe(true);
  });

  test("repeated longer block", () => {
    expect(
      isHallucination(
        "thankyouforwatchingthankyouforwatchingthankyouforwatching",
      ),
    ).toBe(true);
  });

  test("repeated block shorter than 5 chars is not flagged", () => {
    expect(isHallucination("abcdabcdabcd")).toBe(false);
  });

  test("large near-miss transcript is not flagged (no quadratic blowup)", () => {
    const nearMiss = Array.from({ length: 6000 }, (_, i) => `word${i}`).join(
      " ",
    );
    expect(isHallucination(nearMiss)).toBe(false);
  });

  test("WPS too high", () => {
    const words = Array.from({ length: 35 }, (_, i) => `word${i}`).join(" ");
    expect(isHallucination(words, 5000)).toBe(true);
  });

  test("WPS too low for >3 words", () => {
    expect(isHallucination("hello how are you", 30000)).toBe(true);
  });

  test("normal speech passes", () => {
    expect(
      isHallucination("hello how are you today i am doing great", 5000),
    ).toBe(false);
  });

  test("normal text without duration passes", () => {
    expect(isHallucination("This is a perfectly normal sentence.")).toBe(false);
  });

  test("short text without duration passes", () => {
    expect(isHallucination("hello")).toBe(false);
  });
});
