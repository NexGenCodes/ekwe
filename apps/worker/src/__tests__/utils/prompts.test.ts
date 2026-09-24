import { describe, expect, test } from "vitest";
import {
  buildTranslatePrompt,
  needsRomanization,
  parseTranslateOutput,
  ROMANIZATION_MARKER,
} from "@/utils/prompts";

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
