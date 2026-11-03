/**
 * Translation between the wire rows the worker syncs and the local row shape.
 *
 * The server owns `updatedAt` and `revision`; `createdAt` is the device clock.
 * Locally `createdAt` is stored as ISO text, so it is converted on the way in
 * and out here rather than everywhere the sync code touches a row.
 */

import { z } from "zod";

import type { HistoryEntry } from "@/store";
import type { HistoryRow as LocalHistoryRow } from "@/services/db";
import {
  historyRowToEntry,
  normalizeEntryType,
} from "@/services/historyMapper";
import { history } from "@/db/schema";
import { historyRowSchema } from "@ekwe/shared";
import type { HistoryRow as WireHistoryRow } from "@ekwe/shared";

/** A row as the worker sends it: the write shape plus the server `updatedAt`. */
export const syncedRowSchema = historyRowSchema.extend({
  updatedAt: z.number().int(),
});
export type SyncedRow = z.infer<typeof syncedRowSchema>;

export const syncPullResponseSchema = z.object({
  rows: z.array(syncedRowSchema),
  nextCursor: z.string().nullish(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

export const syncPushResultSchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "conflict", "deleted", "not_found"]),
  revision: z.number().int().optional(),
  /** Present on `conflict`: the server's current row, for an immediate rebase. */
  row: syncedRowSchema.optional(),
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;

export const syncPushResponseSchema = z.object({
  results: z.array(syncPushResultSchema),
  serverTime: z.number().optional(),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export function entryToWireRow(
  entry: HistoryEntry,
  revision: number,
  deletedAt: number | null,
  restore = false,
): WireHistoryRow {
  return {
    id: entry.id,
    type: entry.type ?? "transcription",
    captureId: entry.captureId,
    origin: entry.origin,
    input: entry.input,
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
    transcript: entry.transcript,
    translationText: entry.translation,
    transliterationText: entry.transliteration ?? null,
    duration: entry.duration,
    sourceApp: entry.sourceApp ?? "",
    voiceId: entry.voiceId,
    sttProvider: entry.sttProvider,
    mtProvider: entry.mtProvider,
    createdAt: entry.timestamp,
    revision,
    deletedAt,
    restore,
  };
}

/** A local row, ready to push with its last server-confirmed revision. */
export function localRowToWireRow(row: LocalHistoryRow): WireHistoryRow {
  return entryToWireRow(
    historyRowToEntry(row),
    row.revision,
    row.deletedAt,
    row.restore === 1,
  );
}

export function wireRowToEntry(row: SyncedRow): HistoryEntry {
  const sourceApp = row.sourceApp.trim();
  return {
    id: row.id,
    captureId: row.captureId ?? null,
    origin: row.origin,
    input: row.input,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    transcript: row.transcript,
    translation: row.translationText ?? null,
    transliteration: row.transliterationText ?? null,
    duration: row.duration,
    sourceApp: sourceApp ? sourceApp : null,
    voiceId: row.voiceId ?? null,
    sttProvider: row.sttProvider,
    mtProvider: row.mtProvider ?? null,
    timestamp: row.createdAt,
    type: normalizeEntryType(row.type),
  };
}

export function wireRowToLocal(
  row: SyncedRow,
  userId: string,
): typeof history.$inferInsert {
  return {
    id: row.id,
    userId,
    captureId: row.captureId ?? null,
    origin: row.origin,
    input: row.input,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    transcript: row.transcript,
    translationText: row.translationText ?? null,
    transliterationText: row.transliterationText ?? null,
    duration: row.duration,
    sourceApp: row.sourceApp,
    voiceId: row.voiceId ?? null,
    sttProvider: row.sttProvider,
    mtProvider: row.mtProvider ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    revision: row.revision,
    entryType: normalizeEntryType(row.type),
    deletedAt: row.deletedAt ?? null,
    dirty: 0,
    restore: 0,
  };
}
