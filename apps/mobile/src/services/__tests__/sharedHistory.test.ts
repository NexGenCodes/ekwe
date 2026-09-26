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
    // The extension's session key is the capture's identity, so it is
    // promoted rather than discarded as it once was.
    expect(entry.captureId).toBe("sess-1");
    expect(entry.origin).toBe("echo");
    expect(entry.input).toBe("audio");
    expect(entry.sourceApp).toBe("WhatsApp");
    expect(entry.sttProvider).toBe("groq");
  });

  test("maps a transcription-only record", () => {
    const entry = mapSharedRecordToEntry(record({ translation: null }));
    expect(entry.type).toBe("transcription");
    expect(entry.translation).toBeNull();
  });

  test("normalises an empty sourceApp to null rather than a platform sentinel", () => {
    // Used to become "ios", which then had to be special-cased by every
    // display path so it was not shown as if it were an app.
    const entry = mapSharedRecordToEntry(
      record({ sourceApp: "", provider: "" }),
    );
    expect(entry.sourceApp).toBeNull();
    expect(entry.sttProvider).toBe("unknown");
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
