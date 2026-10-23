import { afterEach, describe, expect, it } from "vitest";

import { PLAN_LIMITS } from "@/constants/billing";
import { LANGUAGES } from "@/constants/languages";
import { authActions } from "@/store";
import {
  DEFAULT_LANGUAGES,
  getDefaultSourceLang,
  isAutoDetectPermitted,
  isGenuineLanguageDetection,
  resolveDetectedLanguage,
  sanitizeLanguageCodes,
  unsupportedStoredLanguages,
} from "@/utils/languageUtils";

const KNOWN = LANGUAGES.slice(0, 6).map((l) => l.code);

function setPro(isPro: boolean): void {
  authActions.setUser({
    id: "test-user",
    email: "person@ekwe.app",
    tier: isPro ? "PREMIUM" : "FREE",
    displayName: null,
    avatarUrl: null,
    avatarIcon: null,
    proExpiresAt: null,
  });
}

afterEach(() => {
  setPro(false);
});

describe("DEFAULT_LANGUAGES", () => {
  it("is exactly the languages the app ships selected", () => {
    expect(DEFAULT_LANGUAGES).toEqual(
      LANGUAGES.filter((l) => l.defaultSelected).map((l) => l.code),
    );
  });

  it("contains no duplicates and never includes auto", () => {
    expect(new Set(DEFAULT_LANGUAGES).size).toBe(DEFAULT_LANGUAGES.length);
    expect(DEFAULT_LANGUAGES).not.toContain("auto");
  });
});

describe("sanitizeLanguageCodes", () => {
  it("keeps codes in order and drops the ones it cannot trust", () => {
    const input = [KNOWN[0], "auto", "not-a-language", KNOWN[1]];
    expect(sanitizeLanguageCodes(input, 5)).toEqual([KNOWN[0], KNOWN[1]]);
  });

  it("drops repeats but keeps the first occurrence's position", () => {
    const input = [KNOWN[0], KNOWN[1], KNOWN[0], KNOWN[2]];
    expect(sanitizeLanguageCodes(input, 5)).toEqual([
      KNOWN[0],
      KNOWN[1],
      KNOWN[2],
    ]);
  });

  it("stops at maxLanguages and ignores the rest of the input", () => {
    expect(sanitizeLanguageCodes(KNOWN, 2)).toEqual(KNOWN.slice(0, 2));
  });

  it("never exceeds maxLanguages even when every input is unique", () => {
    for (const max of [0, 1, 3, 99]) {
      expect(sanitizeLanguageCodes(KNOWN, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("allows no languages at all when the cap is zero or negative", () => {
    expect(sanitizeLanguageCodes(KNOWN, 0)).toEqual([]);
    expect(sanitizeLanguageCodes(KNOWN, -1)).toEqual([]);
  });

  it("returns an empty list when nothing survives", () => {
    expect(sanitizeLanguageCodes(["auto", "nope", "und"], 5)).toEqual([]);
  });

  it("returns an empty list for an empty input", () => {
    expect(sanitizeLanguageCodes([], 3)).toEqual([]);
  });
});

describe("getDefaultSourceLang", () => {
  it("uses auto when the tier allows it and en when it does not", () => {
    expect(getDefaultSourceLang(true)).toBe("auto");
    expect(getDefaultSourceLang(false)).toBe("en");
  });
});

describe("isAutoDetectPermitted", () => {
  it("follows the signed-in tier's plan limit", () => {
    setPro(false);
    expect(isAutoDetectPermitted()).toBe(PLAN_LIMITS.free.autoDetectAllowed);

    setPro(true);
    expect(isAutoDetectPermitted()).toBe(PLAN_LIMITS.pro.autoDetectAllowed);
  });
});

describe("resolveDetectedLanguage", () => {
  it("prefers the reported language when the request was auto", () => {
    expect(resolveDetectedLanguage("es", "auto")).toBe("es");
  });

  it("falls back when auto detection reported nothing usable", () => {
    expect(resolveDetectedLanguage(undefined, "auto", "en")).toBe("en");
    expect(resolveDetectedLanguage(null, "auto", "de")).toBe("de");
    expect(resolveDetectedLanguage("auto", "auto", "fr")).toBe("fr");
    expect(resolveDetectedLanguage("und", "auto", "it")).toBe("it");
  });

  it("trusts a detection that contradicts an explicit request", () => {
    expect(resolveDetectedLanguage("es", "en")).toBe("es");
  });

  it("keeps the requested language when detection agrees with it", () => {
    expect(resolveDetectedLanguage("en", "en")).toBe("en");
  });

  it("keeps the requested language when there is no detection at all", () => {
    expect(resolveDetectedLanguage(undefined, "pt")).toBe("pt");
  });

  it("falls back when the requested language is empty and nothing was detected", () => {
    expect(resolveDetectedLanguage(undefined, "")).toBe("en");
    expect(resolveDetectedLanguage(null, "", "de")).toBe("de");
  });
});

describe("isGenuineLanguageDetection", () => {
  it("rejects the sentinel values STT returns instead of a language", () => {
    expect(isGenuineLanguageDetection(undefined, "auto")).toBe(false);
    expect(isGenuineLanguageDetection(null, "en")).toBe(false);
    expect(isGenuineLanguageDetection("auto", "auto")).toBe(false);
    expect(isGenuineLanguageDetection("und", "en")).toBe(false);
  });

  it("accepts any real language when the request was auto", () => {
    expect(isGenuineLanguageDetection("es", "auto")).toBe(true);
  });

  it("accepts a real language only when it differs from what was asked for", () => {
    expect(isGenuineLanguageDetection("es", "en")).toBe(true);
    expect(isGenuineLanguageDetection("en", "en")).toBe(false);
  });
});

describe("unsupportedStoredLanguages", () => {
  it("reports a language the product no longer offers", () => {
    // Yoruba stays in the catalog so names still resolve, but it is outside the
    // offered tier, so a stored selection has to be reported as dropped rather
    // than filtered away without trace.
    expect(unsupportedStoredLanguages(["en", "yo", "fr"])).toEqual(["yo"]);
  });

  it("never reports auto or a language we still offer", () => {
    expect(unsupportedStoredLanguages(["auto", "en", "fr", "de"])).toEqual([]);
  });

  it("handles absent and empty input", () => {
    expect(unsupportedStoredLanguages(undefined)).toEqual([]);
    expect(unsupportedStoredLanguages([])).toEqual([]);
  });

  it("agrees with what sanitizeLanguageCodes actually keeps", () => {
    // The two must not disagree: anything reported here must be absent from the
    // sanitized list, or the app would claim a drop it never performed.
    const stored = ["en", "yo", "ig", "ha", "fr"];
    const kept = sanitizeLanguageCodes(stored, 5);
    for (const dropped of unsupportedStoredLanguages(stored)) {
      expect(kept).not.toContain(dropped);
    }
    expect(kept.length + unsupportedStoredLanguages(stored).length).toBe(
      stored.length,
    );
  });
});
