import { describe, test, expect } from "vitest";
import type { HistoryRow } from "@ekwe/shared";

import { parseOutboxRow, serializeOutboxRow } from "@/services/outboxPayload";

const row: HistoryRow = {
  id: "row-0001",
  type: "translation",
  captureId: "cap-1",
  origin: "echo",
  input: "audio",
  sourceLang: "en",
  targetLang: "fr",
  transcript: "hello",
  translationText: "bonjour",
  transliterationText: null,
  duration: 3,
  sourceApp: "com.whatsapp",
  voiceId: null,
  sttProvider: "deepgram",
  mtProvider: "gemini",
  createdAt: 1_786_000_000_000,
  revision: 0,
  deletedAt: null,
  restore: false,
};

describe("outbox payloads", () => {
  test("round-trips the wire row", () => {
    expect(parseOutboxRow(serializeOutboxRow(row))).toEqual(row);
  });

  test("preserves a delete tombstone", () => {
    const tombstone: HistoryRow = {
      ...row,
      revision: 4,
      deletedAt: 1_786_000_100_000,
    };
    expect(parseOutboxRow(serializeOutboxRow(tombstone))).toEqual(tombstone);
  });

  test("preserves a restore marker with its base revision", () => {
    const restore: HistoryRow = { ...row, revision: 5, restore: true };
    expect(parseOutboxRow(serializeOutboxRow(restore))).toEqual(restore);
  });

  test("rejects corrupt JSON", () => {
    expect(parseOutboxRow("{not-json")).toBeNull();
  });

  test("rejects the legacy snake_case payload", () => {
    expect(
      parseOutboxRow(
        JSON.stringify({
          action: "upsert",
          id: "row-0001",
          source_lang: "en",
          target_lang: "fr",
          created_at: "2026-08-13T10:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });

  test("rejects a row with an invalid timestamp", () => {
    expect(parseOutboxRow(JSON.stringify({ ...row, createdAt: 0 }))).toBeNull();
  });
});
