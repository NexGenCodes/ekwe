import { describe, test, expect } from "vitest";

import {
  canonicalLanguageFromName,
  catalogNameCollisions,
} from "../languageNames";
import { LANGUAGES, LANGUAGE_CODE_SET } from "../languages";

describe("canonicalLanguageFromName", () => {
  test("resolves the English names Whisper-family providers actually return", () => {
    // Groq's verbose_json on whisper-large-v3 answers with the language spelled
    // out. These are the spellings it uses, taken from the live API.
    expect(canonicalLanguageFromName("French")).toBe("fr");
    expect(canonicalLanguageFromName("English")).toBe("en");
    expect(canonicalLanguageFromName("Yoruba")).toBe("yo");
    expect(canonicalLanguageFromName("Cantonese")).toBe("yue");
  });

  test("passes a canonical code through unchanged", () => {
    for (const code of [
      "fr",
      "en",
      "yue",
      "no",
      "nb",
      "nn",
      "ci",
      "ck",
      "haw",
    ]) {
      expect(canonicalLanguageFromName(code)).toBe(code);
    }
  });

  test("accepts a regional tag or script subtag", () => {
    expect(canonicalLanguageFromName("fr-FR")).toBe("fr");
    expect(canonicalLanguageFromName("en_US")).toBe("en");
    expect(canonicalLanguageFromName("zh-Hans")).toBe("zh");
  });

  test("ignores case, diacritics and punctuation", () => {
    expect(canonicalLanguageFromName("FRENCH")).toBe("fr");
    expect(canonicalLanguageFromName("  French  ")).toBe("fr");
    // Our catalog spells this "Raeto Romance"; the provider sends the hyphen.
    expect(canonicalLanguageFromName("Raeto-Romance")).toBe("rm");
    expect(canonicalLanguageFromName("norwegian bokmål")).toBe("nb");
  });

  test("resolves provider spellings that differ from our catalog", () => {
    // Our catalog names these differently; the provider's word is the one that
    // has to resolve, because that is what arrives on the wire.
    const cases: ReadonlyArray<[string, string]> = [
      ["Khmer", "km"],
      ["Lao", "lo"],
      ["Somali", "so"],
      ["Sotho", "st"],
      ["Kinyarwanda", "rw"],
      ["Fulah", "ff"],
      ["Western Frisian", "fy"],
      ["Kalaallisut", "kl"],
      ["Dhivehi", "dv"],
      ["Limburgish", "li"],
      ["Uighur", "ug"],
      ["Pushto", "ps"],
      ["Odia", "or"],
      ["Myanmar", "my"],
      ["Haitian Creole", "ht"],
      ["Valencian", "ca"],
      ["Mandarin", "zh"],
      ["Flemish", "nl"],
      ["Castilian", "es"],
    ];
    for (const [name, code] of cases) {
      expect(canonicalLanguageFromName(name), name).toBe(code);
    }
  });

  test("reads Norwegian as Bokmål, the only Norwegian Whisper speaks", () => {
    // The catalog has a generic `no` and a concrete `nb`; Whisper's only
    // Norwegian token is Bokmål — the same one we send for `nb` via the
    // `nb -> no` alias. Resolving through the catalog would label every
    // Norwegian dictation `no`.
    expect(canonicalLanguageFromName("Norwegian")).toBe("nb");
    expect(canonicalLanguageFromName("Norwegian Nynorsk")).toBe("nn");
    expect(canonicalLanguageFromName("Norwegian Bokmål")).toBe("nb");
    // The codes themselves keep their own meaning.
    expect(canonicalLanguageFromName("no")).toBe("no");
  });

  test("reads a qualified or alternative display name by its base", () => {
    // Our catalog renders these "Chinese (Simplified)" and "Panjabi / Punjabi".
    expect(canonicalLanguageFromName("Chinese")).toBe("zh");
    expect(canonicalLanguageFromName("Punjabi")).toBe("pa");
    expect(canonicalLanguageFromName("Panjabi")).toBe("pa");
    expect(canonicalLanguageFromName("Tagalog")).toBe("tl");
    expect(canonicalLanguageFromName("Filipino")).toBe("tl");
  });

  test("resolves every language in the catalog from its own names", () => {
    // The point of deriving the index from the catalog: coverage cannot lag
    // behind the catalog, whichever language is added or renamed next.
    //
    // `Norwegian` is the single name deliberately not round-tripped: our
    // catalog uses it for generic `no`, while a provider saying it means
    // Bokmål. Asserted on its own in the test above rather than quietly
    // dropped from the sweep.
    const providerOverridden = new Set(["Norwegian"]);

    for (const { code, englishName, nativeName } of LANGUAGES) {
      if (!providerOverridden.has(englishName)) {
        expect(canonicalLanguageFromName(englishName), englishName).toBe(code);
      }
      expect(canonicalLanguageFromName(nativeName), nativeName).toBe(code);
    }
  });

  test("only ever returns a code the catalog carries", () => {
    for (const name of [
      "French",
      "Norwegian",
      "Khmer",
      "Cantonese",
      "Western Frisian",
      ...LANGUAGES.map((l) => l.englishName),
    ]) {
      const resolved = canonicalLanguageFromName(name);
      if (resolved !== undefined) {
        expect(LANGUAGE_CODE_SET.has(resolved), `${name} -> ${resolved}`).toBe(
          true,
        );
      }
    }
  });

  test("treats 'could not tell' as unresolved rather than a language", () => {
    // franc uses `und` for undecided. Defaulting any of these would mislabel
    // every unknown clip, and the caller omits the field so the worker's own
    // detector gets to fill it in.
    for (const value of ["und", "UND", "undetermined", "unknown", "auto", ""]) {
      expect(canonicalLanguageFromName(value), value).toBeUndefined();
    }
    expect(canonicalLanguageFromName(undefined)).toBeUndefined();
    expect(canonicalLanguageFromName(null)).toBeUndefined();
  });

  test("leaves a language we do not carry unresolved", () => {
    // Fijian, Zhuang and Kikuyu are outside the catalog. Reporting the raw
    // string would read as a language we support and then fail every
    // comparison downstream, so the honest answer is "unknown".
    for (const value of ["Fijian", "Zhuang", "Kikuyu"]) {
      expect(canonicalLanguageFromName(value), value).toBeUndefined();
    }
  });

  test("keeps catalog names unambiguous", () => {
    // A name claimed by two codes would be dropped from the index, quietly
    // making that language undetectable. Fail here instead of in production.
    expect(catalogNameCollisions()).toEqual({});
  });
});
