import { syncCursorSchema, type SyncCursor } from "@ekwe/shared";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";

import type { EntryType } from "@/store";

export interface HistoryWriteFields {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string | null;
  voiceId: string | null;
  sttProvider: string;
  mtProvider: string | null;
  origin: HistoryOrigin;
  input: HistoryInput;
}

export function buildUpsertOutboxPayload(
  type: EntryType,
  fields: HistoryWriteFields,
  created_at: string,
  captureId: string | null,
): string {
  return JSON.stringify({
    action: "upsert",
    type,
    capture_id: captureId,
    origin: fields.origin,
    input: fields.input,
    source_lang: fields.sourceLang,
    target_lang: fields.targetLang,
    transcript: fields.transcript,
    translation_text: fields.translation || null,
    transliteration_text: fields.transliteration || null,
    duration: fields.duration,
    source_app: fields.sourceApp,
    voice_id: fields.voiceId,
    stt_provider: fields.sttProvider,
    mt_provider: fields.mtProvider,
    created_at,
  });
}

export function buildDeleteOutboxPayload(id: string): string {
  return JSON.stringify({ action: "delete", id });
}

export function buildDeleteAllOutboxPayload(): string {
  return JSON.stringify({ action: "delete_all" });
}

export function parseSyncCursor(
  stored: string | null | undefined,
): SyncCursor | null {
  if (!stored) return null;
  try {
    const parsed = syncCursorSchema.safeParse(JSON.parse(stored));
    if (parsed.success) return parsed.data;
  } catch {
    // Bare ISO string or corrupt value: treat as no cursor.
  }
  return null;
}
