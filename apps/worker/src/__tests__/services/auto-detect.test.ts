import { describe, test, expect, vi, beforeEach } from "vitest";

import {
  detectTextLanguage,
  validateTranscriptLanguage,
} from "@/services/auto-detect";
import { witDetectLanguage } from "@/providers/witai";
import type { Env } from "@/core/types";
import { hashKey } from "@/utils/keys";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

// Mock the remote stage so tests drive its answer and assert when it is used.
vi.mock("@/providers/witai", () => ({
  witDetectLanguage: vi.fn(),
}));

const mockWit = vi.mocked(witDetectLanguage);

/** Minimal in-memory stand-in for the `cache_lang` D1 table. */
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

// Auto-detect reads the cache through `env.EKWE_D1`.
function envWith(db: D1Database, kv?: Env["EKWE_KV"]): Env {
  return { EKWE_D1: db, EKWE_KV: kv } as unknown as Env;
}

const never = new AbortController().signal;

// Mirrors the cache key `detectTextLanguage` derives.
async function hashFor(text: string): Promise<string> {
  return `auto:${await hashKey(text.slice(0, 2_000))}`;
}

describe("detectTextLanguage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockWit.mockReset();
    mockWit.mockResolvedValue(null);
  });

  test("resolves a clear language from a real sentence", async () => {
    const { db } = createFakeD1();
    await expect(
      detectTextLanguage(
        "Bonjour, comment allez-vous aujourd'hui",
        envWith(db),
        never,
      ),
    ).resolves.toBe("fr");
  });

  test("resolves a non-Latin script to its language code", async () => {
    const { db } = createFakeD1();
    // "これはテストです" — Japanese script, unambiguous.
    await expect(
      detectTextLanguage("これは日本語のテストです", envWith(db), never),
    ).resolves.toBe("ja");
  });

  test("returns unresolved rather than guessing English for unknown text", async () => {
    const { db } = createFakeD1();
    // Regression guard: franc answers ["und", 1], which must not become "en".
    await expect(
      detectTextLanguage("0000 1111 2222 3333", envWith(db), never),
    ).resolves.toBe("");
  });

  test("returns unresolved for blank input", async () => {
    const { db } = createFakeD1();
    await expect(detectTextLanguage("", envWith(db), never)).resolves.toBe("");
    await expect(detectTextLanguage("    ", envWith(db), never)).resolves.toBe(
      "",
    );
  });

  test("returns unresolved for text that is shorter than the franc threshold", async () => {
    const { db } = createFakeD1();
    // Too short for franc, and script-agnostic.
    await expect(detectTextLanguage("ok", envWith(db), never)).resolves.toBe(
      "",
    );
  });

  test("caches a real answer and reuses it", async () => {
    const { db, rows } = createFakeD1();
    const text = "Bonjour, comment allez-vous aujourd'hui";

    await expect(detectTextLanguage(text, envWith(db), never)).resolves.toBe(
      "fr",
    );
    expect(rows.size).toBe(1);

    await expect(detectTextLanguage(text, envWith(db), never)).resolves.toBe(
      "fr",
    );
    expect(rows.size).toBe(1);
  });

  test("never caches an unresolved result", async () => {
    const { db, rows, statements } = createFakeD1();

    await detectTextLanguage("0000 1111 2222 3333", envWith(db), never);

    // Storing "" would make every unknown clip a permanent empty hit.
    expect(rows.size).toBe(0);
    expect(statements.filter((s) => /INSERT|REPLACE/i.test(s))).toHaveLength(0);
  });

  test("returns unresolved when the signal is already aborted", async () => {
    const { db, rows } = createFakeD1();
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      detectTextLanguage(
        "Bonjour, comment allez-vous",
        envWith(db),
        aborted.signal,
      ),
    ).resolves.toBe("");
    expect(rows.size).toBe(0);
  });

  test("does not consult the remote detector when the local answer is confident", async () => {
    const { db } = createFakeD1();
    await detectTextLanguage(
      "Bonjour, comment allez-vous aujourd'hui",
      envWith(db),
      never,
    );
    expect(mockWit).not.toHaveBeenCalled();
  });

  test("keeps a low-confidence local guess when the remote detector has nothing", async () => {
    const { db } = createFakeD1();
    mockWit.mockResolvedValue(null);

    // franc picks afr over deu by a hair: weak evidence, so Wit is asked.
    const text = "asdf qwer zxcv asdf qwer";
    await expect(detectTextLanguage(text, envWith(db), never)).resolves.toBe(
      "af",
    );
    expect(mockWit).toHaveBeenCalledTimes(1);
  });

  test("uses the remote detector when the local guess is low-confidence", async () => {
    const { db, rows } = createFakeD1();
    mockWit.mockResolvedValue("de");

    const text = "asdf qwer zxcv asdf qwer";
    await expect(detectTextLanguage(text, envWith(db), never)).resolves.toBe(
      "de",
    );
    // Remote answers are cached like local ones.
    expect(rows.get(await hashFor(text))).toBe("de");
  });

  test("uses the remote detector when the local stage finds nothing but the text has letters", async () => {
    const { db } = createFakeD1();
    mockWit.mockResolvedValue("de");

    // franc's top answer is unmapped and no script dominates.
    const text = "zzzz qqqq xxxx wwww";
    await expect(detectTextLanguage(text, envWith(db), never)).resolves.toBe(
      "de",
    );
    expect(mockWit).toHaveBeenCalledTimes(1);
  });

  test("does not consult the remote detector for text with no letters", async () => {
    const { db } = createFakeD1();
    await detectTextLanguage("0000 1111 2222 3333", envWith(db), never);
    expect(mockWit).not.toHaveBeenCalled();
  });

  test("does not consult the remote detector below the minimum length", async () => {
    const { db } = createFakeD1();
    await detectTextLanguage("ok", envWith(db), never);
    expect(mockWit).not.toHaveBeenCalled();
  });

  test("skips the remote detector when its circuit is open", async () => {
    const { db } = createFakeD1();
    const kv = {
      get: async () =>
        JSON.stringify({
          trippedAtEpochMs: Date.now(),
          failures: 3,
          openMs: 60_000,
        }),
      put: async () => {},
      delete: async () => {},
    } as unknown as Env["EKWE_KV"];

    const text = "asdf qwer zxcv asdf qwer";
    await expect(
      detectTextLanguage(text, envWith(db, kv), never),
    ).resolves.toBe("af");
    expect(mockWit).not.toHaveBeenCalled();
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
    // franc's ["und", 1] is not a mismatch and must not discard an attempt.
    expect(validateTranscriptLanguage("0000 1111 2222 3333", "en")).toBe(true);
  });

  test("accepts a provider-reported name once it is a canonical code", () => {
    // A provider answers "French"; folding and franc comparison must agree.
    const french = "Bonjour, comment allez-vous aujourd'hui";
    const reported = canonicalLanguageFromName("French");
    expect(reported).toBe("fr");
    expect(validateTranscriptLanguage(french, reported)).toBe(true);

    // A name that differs from our catalog spelling must survive too.
    const yoruba = "Bawo ni, o se tan ju si aalaa mi";
    const yorubaCode = canonicalLanguageFromName("Yoruba");
    expect(yorubaCode).toBe("yo");
    expect(validateTranscriptLanguage(yoruba, yorubaCode)).toBe(true);
  });

  test("rejects a provider-reported name left unfolded", () => {
    // Guard: passing the raw name through compares "french" against franc's "fr".
    const french = "Bonjour, comment allez-vous aujourd'hui";
    expect(validateTranscriptLanguage(french, "French")).toBe(false);
  });
});
