// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import {
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import type { HistoryRow } from "@/services/db";

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
