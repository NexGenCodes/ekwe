import { describe, test, expect } from "vitest";
import {
  hasSharedTranslation,
  mapSharedRecordToEntry,
  SharedHistoryRecord,
} from "@/services/sharedHistory";

function record(
  overrides: Partial<SharedHistoryRecord> = {},
): SharedHistoryRecord {
  return {
    sessionKey: "sess-1",
    sourceLang: "en",
    targetLang: "fr",
    transcript: "hello world",
    translation: null,
    transliteration: null,
    duration: 4200,
    sourceApp: "WhatsApp",
    provider: "groq",
    createdAt: "2026-08-13T10:00:00Z",
    ...overrides,
  };
}

describe("hasSharedTranslation", () => {
  test("is true when a translation exists and differs from the transcript", () => {
    expect(
      hasSharedTranslation({
        translation: "bonjour le monde",
        transcript: "hello world",
      }),
    ).toBe(true);
  });

  test("is false when the translation is null", () => {
    expect(
      hasSharedTranslation({ translation: null, transcript: "hello" }),
    ).toBe(false);
  });

  test("is false when the translation is blank", () => {
    expect(
      hasSharedTranslation({ translation: "   ", transcript: "hello" }),
    ).toBe(false);
  });

  test("is false when the translation equals the transcript", () => {
    expect(
      hasSharedTranslation({ translation: "hello", transcript: "hello" }),
    ).toBe(false);
  });

  test("ignores surrounding whitespace when comparing", () => {
    expect(
      hasSharedTranslation({ translation: " hello ", transcript: "hello" }),
    ).toBe(false);
  });
});

describe("mapSharedRecordToEntry", () => {
  test("maps a translation record", () => {
    const entry = mapSharedRecordToEntry(
      record({ translation: "bonjour le monde" }),
    );
    expect(entry.type).toBe("translation");
    expect(entry.translation).toBe("bonjour le monde");
    expect(entry.sessionKey).toBe("sess-1");
    expect(entry.sourceApp).toBe("WhatsApp");
    expect(entry.provider).toBe("groq");
  });

  test("maps a transcription-only record", () => {
    const entry = mapSharedRecordToEntry(record({ translation: null }));
    expect(entry.type).toBe("transcription");
    expect(entry.translation).toBeNull();
  });

  test("falls back to the ios/unknown defaults for empty sourceApp and provider", () => {
    const entry = mapSharedRecordToEntry(
      record({ sourceApp: "", provider: "" }),
    );
    expect(entry.sourceApp).toBe("ios");
    expect(entry.provider).toBe("unknown");
  });

  test("defaults an undefined duration to zero", () => {
    const entry = mapSharedRecordToEntry(
      record({ duration: undefined as unknown as number }),
    );
    expect(entry.duration).toBe(0);
  });

  test("preserves transliteration when present", () => {
    const entry = mapSharedRecordToEntry(
      record({ translation: "bonjour", transliteration: "bɔ̃ʒuʁ" }),
    );
    expect(entry.transliteration).toBe("bɔ̃ʒuʁ");
  });
});
