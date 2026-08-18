import type { EntryType } from "@/store";

/**
 * Pure marshaling for the history sync outbox + incremental-sync cursor.
 *
 * The outbox rows bridge the local SQLite cache and the cloud history table,
 * so the exact payload shapes here are a contract: changing a key breaks
 * `pushToCloud` (which switches on `action`) or older queued rows. Keeping the
 * builders pure makes that contract unit-testable and keeps `SyncService`
 * free of stringly-typed payload construction.
 */

export interface HistoryWriteFields {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
}

/** Outbox payload for a cloud upsert (new, edited, or restored entry). */
export function buildUpsertOutboxPayload(
  type: EntryType,
  fields: HistoryWriteFields,
  created_at: string,
): string {
  return JSON.stringify({
    action: "upsert",
    type,
    source_lang: fields.sourceLang,
    target_lang: fields.targetLang,
    transcript: fields.transcript,
    translation_text: fields.translation || null,
    transliteration_text: fields.transliteration || null,
    duration: fields.duration,
    source_app: fields.sourceApp,
    provider: fields.provider,
    created_at,
  });
}

/** Outbox payload for deleting a single cloud history row. */
export function buildDeleteOutboxPayload(id: string): string {
  return JSON.stringify({ action: "delete", id });
}

/** Outbox payload for wiping every cloud history row for a user. */
export function buildDeleteAllOutboxPayload(): string {
  return JSON.stringify({ action: "delete_all" });
}

export interface SyncCursor {
  created_at: string;
  id: string;
}

/**
 * Parses the persisted incremental-sync cursor. Returns null when there is
 * nothing stored, when the value is corrupt, or when it predates the composite
 * `{ created_at, id }` format (a bare ISO string) — all of which force a full
 * pull from the cloud.
 */
export function parseSyncCursor(
  stored: string | null | undefined,
): SyncCursor | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as { created_at?: unknown; id?: unknown };
    if (
      typeof parsed?.created_at === "string" &&
      typeof parsed?.id === "string"
    ) {
      return { created_at: parsed.created_at, id: parsed.id };
    }
  } catch {
    // Bare ISO string or corrupt value: treat as no cursor.
  }
  return null;
}
