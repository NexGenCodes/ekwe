import { describe, test, expect } from "vitest";
import {
  buildDeleteAllOutboxPayload,
  buildDeleteOutboxPayload,
  buildUpsertOutboxPayload,
  parseSyncCursor,
} from "@/services/outboxPayload";

describe("buildUpsertOutboxPayload", () => {
  test("produces the snake_case shape pushToCloud depends on", () => {
    const payload = buildUpsertOutboxPayload(
      "translation",
      {
        sourceLang: "en",
        targetLang: "fr",
        transcript: "hello",
        translation: "bonjour",
        transliteration: null,
        duration: 3,
        sourceApp: "com.whatsapp",
        voiceId: null,
        sttProvider: "deepgram",
        mtProvider: "gemini",
        origin: "echo",
        input: "audio",
      },
      "2026-08-13T10:00:00.000Z",
      "cap-1",
    );

    expect(JSON.parse(payload)).toEqual({
      action: "upsert",
      type: "translation",
      capture_id: "cap-1",
      origin: "echo",
      input: "audio",
      source_lang: "en",
      target_lang: "fr",
      transcript: "hello",
      translation_text: "bonjour",
      transliteration_text: null,
      duration: 3,
      source_app: "com.whatsapp",
      voice_id: null,
      stt_provider: "deepgram",
      mt_provider: "gemini",
      created_at: "2026-08-13T10:00:00.000Z",
    });
  });

  test("carries a null capture id for rows written before capture ids", () => {
    const payload = JSON.parse(
      buildUpsertOutboxPayload(
        "transcription",
        {
          sourceLang: "en",
          targetLang: "fr",
          transcript: "hello",
          translation: null,
          transliteration: null,
          duration: 0,
          sourceApp: null,
          voiceId: null,
          sttProvider: "",
          mtProvider: null,
          origin: "speech-studio",
          input: "text",
        },
        "2026-08-13T10:00:00.000Z",
        null,
      ),
    );
    expect(payload.capture_id).toBeNull();
    expect(payload.source_app).toBeNull();
    expect(payload.origin).toBe("speech-studio");
  });

  test("normalises an empty/undefined translation to null", () => {
    const empty = JSON.parse(
      buildUpsertOutboxPayload(
        "transcription",
        {
          sourceLang: "en",
          targetLang: "fr",
          transcript: "hello",
          translation: "",
          transliteration: undefined as unknown as string | null,
          duration: 0,
          sourceApp: null,
          voiceId: null,
          sttProvider: "groq",
          mtProvider: null,
          origin: "echo",
          input: "audio",
        },
        "2026-08-13T10:00:00.000Z",
        "cap-2",
      ),
    );
    expect(empty.translation_text).toBeNull();
    expect(empty.transliteration_text).toBeNull();
  });
});

describe("buildDeleteOutboxPayload", () => {
  test("carries the target history id", () => {
    expect(JSON.parse(buildDeleteOutboxPayload("abc-123"))).toEqual({
      action: "delete",
      id: "abc-123",
    });
  });
});

describe("buildDeleteAllOutboxPayload", () => {
  test("flags the cloud wipe action", () => {
    expect(JSON.parse(buildDeleteAllOutboxPayload())).toEqual({
      action: "delete_all",
    });
  });
});

describe("parseSyncCursor", () => {
  test("returns null when nothing is stored", () => {
    expect(parseSyncCursor(null)).toBeNull();
    expect(parseSyncCursor(undefined as unknown as string)).toBeNull();
    expect(parseSyncCursor("")).toBeNull();
  });

  test("parses a composite { created_at, id } cursor", () => {
    const stored = JSON.stringify({
      created_at: "2026-08-13T10:00:00.000Z",
      id: "row-1",
    });
    expect(parseSyncCursor(stored)).toEqual({
      created_at: "2026-08-13T10:00:00.000Z",
      id: "row-1",
    });
  });

  test("rejects a legacy bare ISO string cursor (forces a full pull)", () => {
    expect(parseSyncCursor("2026-08-13T10:00:00.000Z")).toBeNull();
  });

  test("rejects corrupt JSON", () => {
    expect(parseSyncCursor("{not-json")).toBeNull();
  });

  test("rejects an object missing the required fields", () => {
    expect(
      parseSyncCursor(JSON.stringify({ created_at: "2026-01-01" })),
    ).toBeNull();
    expect(parseSyncCursor(JSON.stringify({}))).toBeNull();
  });

  test("rejects non-string field types", () => {
    expect(
      parseSyncCursor(JSON.stringify({ created_at: 123, id: "row" })),
    ).toBeNull();
  });
});
