/**
 * HistoryRepository — local CRUD abstraction.
 *
 * Handles writeHistory, deleteHistory, restoreHistory, purgeLocalHistory, and clearAllHistory.
 */

import * as Crypto from "expo-crypto";
import { Db } from "@/services/db";
import { history$ } from "@/store";
import { logger } from "@/utils";
import type { HistoryEntry, EntryType } from "@/store";
import type { HistoryOrigin, HistoryInput } from "@ekwe/shared";
import {
  buildUpsertOutboxPayload,
  buildDeleteOutboxPayload,
  buildDeleteAllOutboxPayload,
  type HistoryWriteFields,
} from "@/services/outboxPayload";
import {
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import { MAX_HISTORY_CACHE, INITIAL_HISTORY_SIZE } from "./shared";

export class HistoryRepository {
  private scheduleDrain: () => void;

  constructor(scheduleDrain: () => void) {
    this.scheduleDrain = scheduleDrain;
  }

  async writeHistory(
    payload: {
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
    },
    userId: string,
  ): Promise<string> {
    const fields: HistoryWriteFields = {
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      transcript: payload.transcript,
      translation: payload.translation,
      transliteration: payload.transliteration,
      duration: payload.duration,
      sourceApp: payload.sourceApp,
      voiceId: payload.voiceId,
      sttProvider: payload.sttProvider,
      mtProvider: payload.mtProvider,
      origin: payload.origin,
      input: payload.input,
    };

    const translation = payload.translation || null;
    const transliteration = payload.transliteration || null;

    const existing = payload.captureId
      ? Db.findByCaptureId(userId, payload.captureId)
      : null;
    if (existing) {
      const createdAt = existing.createdAt;
      const baseRevision = existing.revision;

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
          payload: buildUpsertOutboxPayload(
            translation ? "translation" : "transcription",
            fields,
            createdAt,
            payload.captureId,
            baseRevision,
          ),
          userId: userId,
          createdAt: createdAt,
        });
      });

      history$[existing.id].set({
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
        timestamp: Date.parse(createdAt),
        type: translation ? "translation" : "transcription",
      });

      this.scheduleDrain();

      return existing.id;
    }

    const id = Crypto.randomUUID();
    const created_at = new Date().toISOString();

    Db.transaction(() => {
      Db.insertHistory({
        id,
        userId: userId,
        captureId: payload.captureId,
        origin: payload.origin,
        input: payload.input,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        transcript: payload.transcript,
        translationText: translation,
        transliterationText: transliteration,
        duration: payload.duration,
        sourceApp: payload.sourceApp ?? "",
        voiceId: payload.voiceId,
        sttProvider: payload.sttProvider,
        mtProvider: payload.mtProvider,
        createdAt: created_at,
        entryType: payload.type,
      });

      Db.insertOutbox({
        id,
        payload: buildUpsertOutboxPayload(
          payload.type,
          fields,
          created_at,
          payload.captureId,
        ),
        userId: userId,
        createdAt: created_at,
      });
    });

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
      timestamp: Date.now(),
      type: payload.type,
    };
    history$[id].set(entry);
    this.trimHistoryWindow();

    this.scheduleDrain();

    return id;
  }

  async deleteHistory(id: string, userId: string): Promise<void> {
    const created_at = new Date().toISOString();
    const baseRevision = Db.getHistoryRevision(id);
    Db.transaction(() => {
      Db.deleteHistory(id);
      Db.insertOutbox({
        id: Crypto.randomUUID(),
        payload: buildDeleteOutboxPayload(id, baseRevision),
        userId: userId,
        createdAt: created_at,
      });
    });

    history$[id].delete();

    this.scheduleDrain();
  }

  async restoreHistory(rawEntry: HistoryEntry, userId: string): Promise<void> {
    const entry = legacyEntryDefaults(rawEntry);
    const created_at = new Date(entry.timestamp).toISOString();
    const type: EntryType = entry.translation ? "translation" : "transcription";
    const baseRevision = Db.getHistoryRevision(entry.id);

    Db.transaction(() => {
      Db.deleteOutboxForHistory(entry.id);
      Db.insertHistory({
        id: entry.id,
        userId: userId,
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
        createdAt: created_at,
        entryType: type,
      });
      Db.insertOutbox({
        id: entry.id,
        payload: buildUpsertOutboxPayload(
          type,
          {
            sourceLang: entry.sourceLang,
            targetLang: entry.targetLang,
            transcript: entry.transcript,
            translation: entry.translation,
            transliteration: entry.transliteration ?? null,
            duration: entry.duration,
            sourceApp: entry.sourceApp,
            voiceId: entry.voiceId,
            sttProvider: entry.sttProvider,
            mtProvider: entry.mtProvider,
            origin: entry.origin,
            input: entry.input,
          },
          created_at,
          entry.captureId,
          baseRevision,
          true,
        ),
        userId: userId,
        createdAt: created_at,
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

  async clearAllHistory(userId: string): Promise<void> {
    try {
      Db.transaction(() => {
        Db.purgeUserHistory(userId);
        Db.purgeUserOutbox(userId);
        Db.insertOutbox({
          id: Crypto.randomUUID(),
          payload: buildDeleteAllOutboxPayload(),
          userId: userId,
          createdAt: new Date().toISOString(),
        });
      });
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
    if (allKeys.length > MAX_HISTORY_CACHE) {
      const sorted = allKeys
        .map((k) => ({ key: k, ts: history$[k].timestamp.get() || 0 }))
        .sort((a, b) => b.ts - a.ts);
      const toRemove = sorted.slice(MAX_HISTORY_CACHE);
      for (const { key } of toRemove) {
        history$[key].delete();
      }
    }
  }
}
