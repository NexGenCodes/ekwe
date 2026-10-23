/**
 * HistoryRepository — local CRUD plus outbox enqueueing.
 *
 * Every mutation writes the local row and queues the full wire row, so the
 * drain can push it without re-deriving state. Deletes are soft: the row stays
 * as a local tombstone so its revision survives for an Undo.
 */

import * as Crypto from "expo-crypto";

import { Db } from "@/services/db";
import { serializeOutboxRow } from "@/services/outboxPayload";
import { history$ } from "@/store";
import type { EntryType, HistoryEntry } from "@/store";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";
import {
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import logger from "@/utils/logger";

import { entryToWireRow, localRowToWireRow } from "./wireRows";
import { INITIAL_HISTORY_SIZE, MAX_HISTORY_CACHE } from "./shared";

export interface HistoryWritePayload {
  captureId: string;
  origin: HistoryOrigin;
  input: HistoryInput;
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
  type: EntryType;
}

function entryToLocalInsert(
  entry: HistoryEntry,
  userId: string,
  createdAt: string,
  revision: number,
  deletedAt: number | null = null,
): Parameters<typeof Db.insertHistory>[0] {
  return {
    id: entry.id,
    userId,
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
    createdAt,
    revision,
    entryType: entry.type ?? "transcription",
    deletedAt,
  };
}

export class HistoryRepository {
  private scheduleDrain: () => void;

  constructor(scheduleDrain: () => void) {
    this.scheduleDrain = scheduleDrain;
  }

  async writeHistory(
    payload: HistoryWritePayload,
    userId: string,
  ): Promise<string> {
    const translation = payload.translation || null;
    const transliteration = payload.transliteration || null;

    const existing = payload.captureId
      ? Db.findByCaptureId(userId, payload.captureId)
      : null;

    if (existing) {
      const type: EntryType = translation ? "translation" : "transcription";
      const entry: HistoryEntry = {
        id: existing.id,
        captureId: payload.captureId,
        origin: payload.origin,
        input: payload.input,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        transcript: payload.transcript,
        translation,
        transliteration,
        duration: payload.duration,
        sourceApp: payload.sourceApp,
        voiceId: payload.voiceId,
        sttProvider: payload.sttProvider,
        mtProvider: payload.mtProvider,
        timestamp: Date.parse(existing.createdAt),
        type,
      };

      Db.transaction(() => {
        Db.updateCaptureRow(existing.id, {
          transcript: payload.transcript,
          translation_text: translation,
          transliteration_text: transliteration,
          duration: payload.duration,
          source_app: payload.sourceApp,
          voice_id: payload.voiceId,
          stt_provider: payload.sttProvider,
          mt_provider: payload.mtProvider,
          origin: payload.origin,
          input: payload.input,
        });
        Db.insertOutbox({
          id: existing.id,
          payload: serializeOutboxRow(
            entryToWireRow(entry, existing.revision, null),
          ),
          userId,
          createdAt: existing.createdAt,
        });
      });

      history$[existing.id].set(entry);
      this.scheduleDrain();
      return existing.id;
    }

    const id = Crypto.randomUUID();
    const timestamp = Date.now();
    const createdAt = new Date(timestamp).toISOString();
    const entry: HistoryEntry = {
      id,
      captureId: payload.captureId,
      origin: payload.origin,
      input: payload.input,
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      transcript: payload.transcript,
      translation,
      transliteration,
      duration: payload.duration,
      sourceApp: payload.sourceApp,
      voiceId: payload.voiceId,
      sttProvider: payload.sttProvider,
      mtProvider: payload.mtProvider,
      timestamp,
      type: payload.type,
    };

    Db.transaction(() => {
      Db.insertHistory(entryToLocalInsert(entry, userId, createdAt, 0));
      Db.insertOutbox({
        id,
        payload: serializeOutboxRow(entryToWireRow(entry, 0, null)),
        userId,
        createdAt,
      });
    });

    history$[id].set(entry);
    this.trimHistoryWindow();
    this.scheduleDrain();

    return id;
  }

  async deleteHistory(id: string, userId: string): Promise<void> {
    const row = Db.getHistoryById(id);
    if (!row) {
      history$[id].delete();
      return;
    }

    const deletedAt = Date.now();
    const wire = {
      ...localRowToWireRow(row),
      deletedAt,
      restore: false,
    };

    Db.transaction(() => {
      // A queued edit for this row would otherwise land before the delete and
      // leave the server's revision ahead of the tombstone's base revision.
      Db.deleteOutboxForHistory(id);
      Db.markHistoryDeleted(id, deletedAt);
      Db.insertOutbox({
        id: Crypto.randomUUID(),
        payload: serializeOutboxRow(wire),
        userId,
        createdAt: new Date(deletedAt).toISOString(),
      });
    });

    history$[id].delete();
    this.scheduleDrain();
  }

  async restoreHistory(rawEntry: HistoryEntry, userId: string): Promise<void> {
    const entry = legacyEntryDefaults(rawEntry);
    const type: EntryType = entry.translation ? "translation" : "transcription";
    const existing = Db.getHistoryById(entry.id);
    const revision = existing?.revision ?? 0;
    const createdAt =
      existing?.createdAt ?? new Date(entry.timestamp).toISOString();

    Db.transaction(() => {
      Db.deleteOutboxForHistory(entry.id);
      Db.insertHistory(entryToLocalInsert(entry, userId, createdAt, revision));
      Db.insertOutbox({
        id: entry.id,
        payload: serializeOutboxRow(
          entryToWireRow({ ...entry, type }, revision, null, true),
        ),
        userId,
        createdAt,
      });
    });

    history$[entry.id].set(entry);
    this.scheduleDrain();
  }

  purgeLocalHistory(userId: string): void {
    try {
      Db.transaction(() => {
        Db.purgeUserHistory(userId);
        Db.purgeUserOutbox(userId);
      });
      history$.set({});
      logger.info("[Sync] Purged local history + outbox for user", userId);
    } catch (err) {
      logger.error("[Sync] purgeLocalHistory failed", err);
    }
  }

  /**
   * Deletes every live row by tombstoning it. The worker has no bulk delete,
   * so this queues one delete per row and lets the drain chunk them.
   */
  async clearAllHistory(userId: string): Promise<void> {
    try {
      const live = Db.getAllHistory(userId).filter(
        (row) => row.deletedAt == null,
      );
      const now = Date.now();
      const createdAt = new Date(now).toISOString();

      if (live.length > 0) {
        Db.transaction(() => {
          for (const row of live) {
            Db.deleteOutboxForHistory(row.id);
            Db.markHistoryDeleted(row.id, now);
            Db.insertOutbox({
              id: Crypto.randomUUID(),
              payload: serializeOutboxRow({
                ...localRowToWireRow(row),
                deletedAt: now,
                restore: false,
              }),
              userId,
              createdAt,
            });
          }
        });
      }

      history$.set({});
      this.scheduleDrain();
    } catch (err) {
      logger.error("[Sync] clearAllHistory failed", err);
      throw err;
    }
  }

  loadInitialHistory(userId?: string): void {
    history$.set({});
    if (!userId) return;
    const rows = Db.getRecentHistory(userId, INITIAL_HISTORY_SIZE);
    for (const row of rows) {
      history$[row.id].set(historyRowToEntry(row));
    }
  }

  private trimHistoryWindow(): void {
    const allKeys = Object.keys(history$.get() || {});
    if (allKeys.length <= MAX_HISTORY_CACHE) return;

    const sorted = allKeys
      .map((key) => ({ key, ts: history$[key].timestamp.get() || 0 }))
      .sort((a, b) => b.ts - a.ts);
    for (const { key } of sorted.slice(MAX_HISTORY_CACHE)) {
      history$[key].delete();
    }
  }
}
