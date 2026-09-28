import { describe, test, expect, vi, beforeEach } from "vitest";

import {
  detectTextLanguage,
  validateTranscriptLanguage,
} from "@/services/auto-detect";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

/**
 * Minimal in-memory stand-in for the `cache_lang` D1 table. Auto-detect only
 * ever issues a SELECT and an INSERT/REPLACE against it, so recording the
 * statements is enough to assert both reads and writes.
 */
function createFakeD1() {
  const rows = new Map<string, string>();
  const statements: string[] = [];

  const db = {
    prepare(sql: string) {
      statements.push(sql.trim().split(/\s+/).join(" "));
      return {
        bind(...args: unknown[]) {
          const bound = args as (string | number)[];
          return {
            async first<T>() {
              const match = /FROM\s+cache_lang/.test(sql);
              if (!match) return null;
              const value = rows.get(String(bound[0]));
              if (value === undefined) return null;
              return {
                detected_lang: value,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
              } as T;
            },
            async run() {
              if (/INSERT|REPLACE/i.test(sql)) {
                rows.set(String(bound[0]), String(bound[1]));
              } else if (/DELETE/i.test(sql)) {
                rows.delete(String(bound[0]));
              }
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as D1Database, rows, statements };
}

const never = new AbortController().signal;

describe("detectTextLanguage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("resolves a clear language from a real sentence", async () => {
    const { db } = createFakeD1();
    await expect(
      detectTextLanguage("Bonjour, comment allez-vous aujourd'hui", db, never),
    ).resolves.toBe("fr");
  });

  test("resolves a non-Latin script to its language code", async () => {
    const { db } = createFakeD1();
    // "これはテストです" — Japanese script, unambiguous.
    await expect(
      detectTextLanguage("これは日本語のテストです", db, never),
    ).resolves.toBe("ja");
  });

  test("returns unresolved rather than guessing English for unknown text", async () => {
    const { db } = createFakeD1();
    // Regression guard: franc answers ["und", 1] for this, and the old code
    // turned that into "en", which mislabelled every unknown clip as English.
    // Numeric content is realistic here — a transcript of figures has no
    // language, so reporting none is the honest answer.
    await expect(
      detectTextLanguage("0000 1111 2222 3333", db, never),
    ).resolves.toBe("");
  });

  test("returns unresolved for blank input", async () => {
    const { db } = createFakeD1();
    await expect(detectTextLanguage("", db, never)).resolves.toBe("");
    await expect(detectTextLanguage("    ", db, never)).resolves.toBe("");
  });

  test("returns unresolved for text that is shorter than the franc threshold", async () => {
    const { db } = createFakeD1();
    // Too short for franc to say anything, and script-agnostic, so there is no
    // evidence to report.
    await expect(detectTextLanguage("ok", db, never)).resolves.toBe("");
  });

  test("caches a real answer and reuses it", async () => {
    const { db, rows } = createFakeD1();
    const text = "Bonjour, comment allez-vous aujourd'hui";

    await expect(detectTextLanguage(text, db, never)).resolves.toBe("fr");
    expect(rows.size).toBe(1);

    await expect(detectTextLanguage(text, db, never)).resolves.toBe("fr");
    expect(rows.size).toBe(1);
  });

  test("never caches an unresolved result", async () => {
    const { db, rows, statements } = createFakeD1();

    await detectTextLanguage("0000 1111 2222 3333", db, never);

    // Storing "" would turn every unknown clip into a permanent cache hit that
    // still resolves to nothing.
    expect(rows.size).toBe(0);
    expect(statements.filter((s) => /INSERT|REPLACE/i.test(s))).toHaveLength(0);
  });

  test("returns unresolved when the signal is already aborted", async () => {
    const { db, rows } = createFakeD1();
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      detectTextLanguage("Bonjour, comment allez-vous", db, aborted.signal),
    ).resolves.toBe("");
    expect(rows.size).toBe(0);
  });
});

describe("validateTranscriptLanguage", () => {
  test("accepts a transcript whose language matches", () => {
    expect(
      validateTranscriptLanguage(
        "Bonjour, comment allez-vous aujourd'hui",
        "fr",
      ),
    ).toBe(true);
  });

  test("rejects a transcript whose language clearly disagrees", () => {
    expect(
      validateTranscriptLanguage(
        "Bonjour, comment allez-vous aujourd'hui",
        "de",
      ),
    ).toBe(false);
  });

  test("accepts when there is no transcript language to check against", () => {
    expect(validateTranscriptLanguage("Bonjour", undefined)).toBe(true);
    expect(validateTranscriptLanguage("", "fr")).toBe(true);
  });

  test("does not reject on franc's undetermined answer", () => {
    // franc returns ["und", 1] for scriptless text. That is not a mismatch, so
    // it must not cause a provider attempt to be discarded.
    expect(validateTranscriptLanguage("0000 1111 2222 3333", "en")).toBe(true);
  });

  test("accepts a provider-reported name once it is a canonical code", () => {
    // This is the seam the whole design depends on. A Whisper-family provider
    // answers "French"; the provider folds that to `fr` via
    // canonicalLanguageFromName; this check then has to agree with franc. If
    // either half drifts — the folding, or the comparison — a correct
    // transcription gets discarded.
    const french = "Bonjour, comment allez-vous aujourd'hui";
    const reported = canonicalLanguageFromName("French");
    expect(reported).toBe("fr");
    expect(validateTranscriptLanguage(french, reported)).toBe(true);

    // A language whose name differs from our catalog spelling must survive the
    // same round trip, or it would be undetectable in practice.
    const yoruba = "Bawo ni, o se tan ju si aalaa mi";
    const yorubaCode = canonicalLanguageFromName("Yoruba");
    expect(yorubaCode).toBe("yo");
    expect(validateTranscriptLanguage(yoruba, yorubaCode)).toBe(true);
  });

  test("rejects a provider-reported name left unfolded", () => {
    // The bug this guards: passing the raw name straight through compares
    // "french" against franc's "fr", so every auto-detected transcript from a
    // name-returning provider is thrown away.
    const french = "Bonjour, comment allez-vous aujourd'hui";
    expect(validateTranscriptLanguage(french, "French")).toBe(false);
  });
});
