/**
 * HistoryRepository — local CRUD plus dirty-marking.
 *
 * Every mutation writes the local row and marks it dirty; the push service
 * sends dirty rows. Deletes are soft so the row's revision survives for Undo.
 */

import * as Crypto from "expo-crypto";

import { Db } from "@/services/db";
import { history$ } from "@/store";
import type { EntryType, HistoryEntry } from "@/store";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";
import {
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import logger from "@/utils/logger";

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
  restore = 0,
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
    dirty: 1,
    restore,
  };
}

export class HistoryRepository {
  private schedulePush: () => void;

  constructor(schedulePush: () => void) {
    this.schedulePush = schedulePush;
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

      history$[existing.id].set(entry);
      this.schedulePush();
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

    Db.insertHistory(entryToLocalInsert(entry, userId, createdAt, 0));

    history$[id].set(entry);
    this.trimHistoryWindow();
    this.schedulePush();

    return id;
  }

  async deleteHistory(id: string, _userId: string): Promise<void> {
    const row = Db.getHistoryById(id);
    if (!row) {
      history$[id].delete();
      return;
    }

    Db.markHistoryDeleted(id, Date.now());
    history$[id].delete();
    this.schedulePush();
  }

  async restoreHistory(rawEntry: HistoryEntry, userId: string): Promise<void> {
    const entry = legacyEntryDefaults(rawEntry);
    const existing = Db.getHistoryById(entry.id);
    const revision = existing?.revision ?? 0;
    const createdAt =
      existing?.createdAt ?? new Date(entry.timestamp).toISOString();

    Db.insertHistory(
      entryToLocalInsert(entry, userId, createdAt, revision, null, 1),
    );

    history$[entry.id].set(entry);
    this.schedulePush();
  }

  purgeLocalHistory(userId: string): void {
    try {
      Db.purgeUserHistory(userId);
      history$.set({});
      logger.info("[Sync] Purged local history for user", userId);
    } catch (err) {
      logger.error("[Sync] purgeLocalHistory failed", err);
    }
  }

  /** Tombstones every live row; the push service sends one delete per row. */
  async clearAllHistory(userId: string): Promise<void> {
    try {
      const live = Db.getAllHistory(userId).filter(
        (row) => row.deletedAt == null,
      );
      const now = Date.now();

      if (live.length > 0) {
        Db.transaction(() => {
          for (const row of live) {
            Db.markHistoryDeleted(row.id, now);
          }
        });
      }

      history$.set({});
      this.schedulePush();
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
