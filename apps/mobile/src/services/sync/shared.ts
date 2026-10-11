/**
 * Shared helpers and types used across the sync subsystem.
 *
 * These were originally private to `syncService.ts`. Extracted here so that
 * OutboxDrain, CloudSync, RealtimeSync, and HistoryRepository can import them
 * without circular dependencies.
 */

import type { EntryType } from "@/store";

/** Coerces thrown objects into an Error instance. */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    const record = err as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (typeof record.message === "string" && record.message) {
      const code = typeof record.code === "string" ? ` (${record.code})` : "";
      const error = new Error(`${record.message}${code}`);
      if (typeof record.code === "string") {
        (error as Error & { code?: string }).code = record.code;
      }
      return error;
    }
  }
  if (typeof err === "string") return new Error(err);
  return new Error(JSON.stringify(err));
}

export const CLOUD_COLUMNS =
  "id, user_id, capture_id, origin, input, source_lang, target_lang, transcript, translation_text, transliteration_text, duration, source_app, voice_id, stt_provider, mt_provider, created_at, type, revision, deleted_at";

export type CloudRow = {
  id: string;
  user_id: string;
  created_at: string;
  capture_id: string | null;
  origin: string | null;
  input: string | null;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  transliteration_text: string | null;
  duration: number;
  source_app: string | null;
  voice_id: string | null;
  stt_provider: string | null;
  mt_provider: string | null;
  type: EntryType | null;
  /** Server-assigned version. Absent on rows written before the column existed. */
  revision?: number | null;
  /** Set when the row is deleted. The server keeps it as a tombstone. */
  deleted_at?: string | null;
};

/**
 * Represents the result of `history_upsert_if_fresh`.
 */
export type HistoryUpsertResult = {
  id: string;
  /**
   * `deleted` means the server holds a tombstone for this row: it was deleted,
   * possibly on another device, and an ordinary write will not bring it back.
   * `restored` means an undo cleared that tombstone.
   */
  outcome: "inserted" | "applied" | "conflict" | "deleted" | "restored";
  revision: number | null;
  /** The server's current row, present so a refusal needs no second query. */
  server_row: CloudRow | null;
};

export type HistoryDeleteResult = {
  id: string;
  outcome: "deleted" | "already_deleted" | "conflict";
  revision: number | null;
};

/** Checks if a pending outbox payload is a whole-history delete. */
export function isDeleteAllPayload(payload: string): boolean {
  return readOutboxAction(payload) === "delete_all";
}

/** Whether a pending outbox payload deletes this specific row. */
export function isDeletePayloadFor(payload: string, id: string): boolean {
  const parsed = readOutboxActionId(payload);
  return parsed.action === "delete" && parsed.id === id;
}

export function readOutboxAction(payload: string): string | null {
  return readOutboxActionId(payload).action;
}

export function readOutboxActionId(payload: string): {
  action: string | null;
  id?: string;
} {
  try {
    const parsed = JSON.parse(payload) as { action?: string; id?: string };
    return { action: parsed.action ?? null, id: parsed.id };
  } catch {
    return { action: null };
  }
}

// ── Constants ──────────────────────────────────────────────────────────

export const INITIAL_HISTORY_SIZE = 20;
export const MAX_HISTORY_CACHE = 1000;
export const LOCAL_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DRAIN_TIMEOUT_MS = 15_000;
export const DRAIN_BASE_DELAY_MS = 500;
export const DRAIN_MAX_BACKOFF_MS = 60_000;
export const REALTIME_RETRY_BASE_MS = 2_000;
export const REALTIME_RETRY_MAX_MS = 60_000;
export const REALTIME_MAX_RETRIES = 5;
/** Jitter band for realtime backoff, represented as a fraction of the base delay. */
export const REALTIME_RETRY_JITTER = 0.5;
