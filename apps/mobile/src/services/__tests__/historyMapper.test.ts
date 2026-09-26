// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import {
  cloudRowToEntry,
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import type { HistoryCloudRow } from "@/services/historyMapper";
import type { HistoryRow } from "@/services/db";

function cloudRow(overrides: Partial<HistoryCloudRow> = {}): HistoryCloudRow {
  return {
    id: "row-1",
    user_id: "user-1",
    created_at: "2026-09-01T10:00:00.000Z",
    capture_id: "cap-1",
    origin: "echo",
    input: "audio",
    source_lang: "es",
    target_lang: "fr",
    transcript: "hola",
    translation_text: "bonjour",
    transliteration_text: null,
    duration: 4,
    source_app: "com.whatsapp",
    voice_id: null,
    stt_provider: "deepgram",
    mt_provider: "gemini",
    type: "translation",
    ...overrides,
  };
}

describe("cloudRowToEntry", () => {
  it("maps a current row faithfully", () => {
    const entry = cloudRowToEntry(cloudRow());
    expect(entry).toMatchObject({
      id: "row-1",
      captureId: "cap-1",
      origin: "echo",
      input: "audio",
      sourceApp: "com.whatsapp",
      sttProvider: "deepgram",
      mtProvider: "gemini",
      translation: "bonjour",
      type: "translation",
    });
    expect(entry.timestamp).toBe(Date.parse("2026-09-01T10:00:00.000Z"));
  });

  it("normalises a blank source app to null", () => {
    expect(cloudRowToEntry(cloudRow({ source_app: "" })).sourceApp).toBeNull();
    expect(
      cloudRowToEntry(cloudRow({ source_app: null })).sourceApp,
    ).toBeNull();
    expect(
      cloudRowToEntry(cloudRow({ source_app: "  " })).sourceApp,
    ).toBeNull();
  });

  it("keeps a real origin regardless of source_app", () => {
    // A stored origin is authoritative; source_app plays no part in it.
    expect(
      cloudRowToEntry(
        cloudRow({ origin: "speech-studio", source_app: "ekwe-home" }),
      ).origin,
    ).toBe("speech-studio");
  });

  it("files any unrecognised origin under echo", () => {
    // The column is NOT NULL DEFAULT 'echo', so a row with no recognised
    // origin is indistinguishable from a pre-column one — and pre-column rows
    // were all backfilled to echo, so echo is the honest answer.
    expect(
      cloudRowToEntry(cloudRow({ origin: null, source_app: "ekwe-home" }))
        .origin,
    ).toBe("echo");

    expect(
      cloudRowToEntry(cloudRow({ origin: null, source_app: "com.whatsapp" }))
        .origin,
    ).toBe("echo");
  });

  it("infers text input for a zero-duration studio row", () => {
    // Studio rows with no recording behind them were typed, not dictated.
    expect(
      cloudRowToEntry(
        cloudRow({ origin: "speech-studio", input: null, duration: 0 }),
      ).input,
    ).toBe("text");
  });

  it("defaults a missing input to audio", () => {
    expect(cloudRowToEntry(cloudRow({ input: null, duration: 9 })).input).toBe(
      "audio",
    );
  });

  it("coerces a null duration to zero", () => {
    expect(cloudRowToEntry(cloudRow({ duration: null })).duration).toBe(0);
  });

  it("defaults a null stt provider to an empty string", () => {
    expect(cloudRowToEntry(cloudRow({ stt_provider: null })).sttProvider).toBe(
      "",
    );
  });
});

describe("historyRowToEntry", () => {
  it("maps the local row shape", () => {
    const row = {
      id: "local-1",
      userId: "user-1",
      captureId: "cap-2",
      origin: "orb",
      input: "audio",
      sourceLang: "en",
      targetLang: "es",
      transcript: "hi",
      translationText: "hola",
      transliterationText: null,
      duration: 2,
      sourceApp: "",
      voiceId: null,
      sttProvider: "gladia",
      mtProvider: null,
      createdAt: "2026-09-02T00:00:00.000Z",
      entryType: "translation",
    } as unknown as HistoryRow;

    expect(historyRowToEntry(row)).toMatchObject({
      origin: "orb",
      sourceApp: null,
      sttProvider: "gladia",
      translation: "hola",
    });
  });
});

describe("legacyEntryDefaults", () => {
  it("fills every field so an Undo restores a complete row", () => {
    // An entry captured in memory before the new fields existed.
    const restored = legacyEntryDefaults({
      id: "old",
      sourceLang: "en",
      targetLang: "es",
      transcript: "hello",
      translation: "hola",
      timestamp: 123,
      duration: 3,
      sourceApp: null,
    } as never);

    expect(restored).toMatchObject({
      id: "old",
      captureId: null,
      origin: "echo",
      input: "audio",
      voiceId: null,
      sttProvider: "",
      mtProvider: null,
      transliteration: null,
    });
  });

  it("keeps a stored speech-studio origin and infers typed input", () => {
    const restored = legacyEntryDefaults({
      id: "old",
      origin: "speech-studio",
      sourceApp: "ekwe",
      sourceLang: "en",
      targetLang: "es",
      transcript: "hello",
      translation: null,
      timestamp: 1,
      duration: 0,
    } as never);

    expect(restored.origin).toBe("speech-studio");
    // Zero duration on a Speech Studio row means it was typed.
    expect(restored.input).toBe("text");
  });
});
