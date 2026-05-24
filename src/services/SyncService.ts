import { observable } from '@legendapp/state';
import * as Crypto from 'expo-crypto';

import { supabase } from '@/services/supabase';
import { HistoryEntry, history$ } from '@/store';
import { logger } from '@/utils';
import { checkIsOnline, subscribeToNetwork } from '@/utils/netInfo';
import { Db } from './db';

const HISTORY_WINDOW_SIZE = 200;
const PAGE_SIZE = 50;

class SyncServiceClass {
  private unsubscribeNetInfo: (() => void) | null = null;
  private isDraining = false;

  pendingCount = observable(0);

  async writeHistory(
    payload: {
      sourceLang: string;
      targetLang: string;
      transcript: string;
      translation: string | null;
      transliteration: string | null;
      duration: number;
      sourceApp: string;
      provider: string;
    },
    userId: string,
  ): Promise<string> {
    const id = Crypto.randomUUID();
    const created_at = new Date().toISOString();

    Db.transaction(async () => {
      Db.insertHistory({
        id,
        user_id: userId,
        source_lang: payload.sourceLang,
        target_lang: payload.targetLang,
        transcript: payload.transcript,
        translation_text: payload.translation || null,
        transliteration_text: payload.transliteration || null,
        duration: payload.duration,
        source_app: payload.sourceApp,
        provider: payload.provider,
        created_at,
      });

      Db.insertOutbox({
        id,
        payload: JSON.stringify({
          source_lang: payload.sourceLang,
          target_lang: payload.targetLang,
          transcript: payload.transcript,
          translation_text: payload.translation || null,
          transliteration_text: payload.transliteration || null,
          duration: payload.duration,
          source_app: payload.sourceApp,
          provider: payload.provider,
          created_at,
        }),
        user_id: userId,
        created_at,
      });
    });

    const entry: HistoryEntry = {
      id,
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      transcript: payload.transcript,
      translation: payload.translation || null,
      transliteration: payload.transliteration || null,
      duration: payload.duration,
      sourceApp: payload.sourceApp,
      provider: payload.provider,
      timestamp: Date.now(),
      deleted: false,
    };
    history$[id].set(entry);
    this.trimHistoryWindow();
    this.refreshPendingCount();

    this.pushToCloud(id).catch(() => {});

    return id;
  }

  async updateHistoryTranslation(
    id: string,
    translation: string,
    transliteration: string | null,
    targetLang: string,
  ): Promise<void> {
    Db.transaction(async () => {
      Db.updateHistoryTranslation(id, translation, transliteration, targetLang);
    });

    const existing = history$[id].get();
    if (existing) {
      history$[id].translation.set(translation);
      history$[id].transliteration.set(transliteration);
      history$[id].targetLang.set(targetLang);
    }

    try {
      const { error } = await supabase
        .from('history')
        .update({
          translation_text: translation,
          transliteration_text: transliteration ?? null,
          target_lang: targetLang,
        })
        .eq('id', id);
      if (error) throw error;
    } catch {
      logger.warn('[Sync] Failed to update translation on cloud', id);
    }
  }

  private async pushToCloud(id: string): Promise<void> {
    try {
      Db.markOutboxInFlight(id);
      const rows = Db.getPendingOutbox();
      const row = rows.find((r) => r.id === id);
      if (!row) return;

      const payload = JSON.parse(row.payload);
      const { error } = await supabase.from('history').upsert({
        id: row.id,
        user_id: row.user_id,
        source_lang: payload.source_lang,
        target_lang: payload.target_lang,
        transcript: payload.transcript,
        translation_text: payload.translation_text,
        transliteration_text: payload.transliteration_text,
        duration: payload.duration,
        source_app: payload.source_app,
        provider: payload.provider,
        created_at: payload.created_at,
      });
      if (error) throw error;

      Db.deleteOutbox(id);
      logger.info('[Sync] Pushed entry to cloud', id);
    } catch (err) {
      Db.incrementOutboxRetry(id);
      logger.error('[Sync] Push failed for entry', id, err);
    }
    this.refreshPendingCount();
  }

  async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      const online = await checkIsOnline();
      if (!online) return;

      const entries = Db.getPendingOutbox();
      if (entries.length === 0) return;

      logger.info('[Sync] Draining', entries.length, 'pending entries');

      for (const entry of entries) {
        await this.pushToCloud(entry.id);
      }
    } finally {
      this.isDraining = false;
      this.refreshPendingCount();
    }
  }

  async pullFromCloud(userId: string): Promise<void> {
    try {
      const lastSyncKey = `last-sync-${userId}`;
      const lastSync = Db.getStore(lastSyncKey);

      let query = supabase
        .from('history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (lastSync) {
        query = query.gt('created_at', lastSync);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return;

      for (const row of data) {
        Db.insertHistory({
          id: row.id,
          user_id: row.user_id,
          source_lang: row.source_lang,
          target_lang: row.target_lang,
          transcript: row.transcript,
          translation_text: row.translation_text,
          transliteration_text: row.transliteration_text,
          duration: row.duration || 0,
          source_app: row.source_app || '',
          provider: row.provider || '',
          created_at: row.created_at,
        });

        if (!history$[row.id].get()) {
          history$[row.id].set({
            id: row.id,
            sourceLang: row.source_lang,
            targetLang: row.target_lang,
            transcript: row.transcript,
            translation: row.translation_text,
            transliteration: row.transliteration_text,
            duration: row.duration || 0,
            sourceApp: row.source_app || '',
            provider: row.provider || '',
            timestamp: new Date(row.created_at).getTime(),
            deleted: row.deleted === true,
          });
        }
      }

      if (data.length > 0) {
        Db.setStore(lastSyncKey, data[0].created_at);
      }

      this.trimHistoryWindow();
      logger.info('[Sync] Pulled', data.length, 'entries from cloud');
    } catch (err) {
      logger.error('[Sync] Pull from cloud failed', err);
    }
  }

  private trimHistoryWindow(): void {
    const allKeys = Object.keys(history$.get() || {});
    if (allKeys.length > HISTORY_WINDOW_SIZE) {
      const sorted = allKeys
        .map((k) => ({ key: k, ts: history$[k].timestamp.get() || 0 }))
        .sort((a, b) => b.ts - a.ts);
      const toRemove = sorted.slice(HISTORY_WINDOW_SIZE);
      for (const { key } of toRemove) {
        history$[key].delete();
      }
    }
  }

  private refreshPendingCount(): void {
    const count = Db.getPendingOutbox().length;
    this.pendingCount.set(count);
  }

  loadInitialHistory(): void {
    const rows = Db.getRecentHistory(HISTORY_WINDOW_SIZE);
    for (const row of rows) {
      history$[row.id].set({
        id: row.id,
        sourceLang: row.source_lang,
        targetLang: row.target_lang,
        transcript: row.transcript,
        translation: row.translation_text,
        transliteration: row.transliteration_text,
        duration: row.duration,
        sourceApp: row.source_app,
        provider: row.provider,
        timestamp: new Date(row.created_at).getTime(),
        deleted: row.deleted === 1,
      });
    }
    this.refreshPendingCount();
  }

  async start(userId?: string): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;

    this.loadInitialHistory();

    Db.cleanupExpiredHistory(7);
    Db.cleanupDeadOutbox();
    Db.cleanupStalePendingOutbox();

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (isOnline) {
        this.drain().catch(() => {});
      }
    });
  }

  stop(): void {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }
}

export const SyncService = new SyncServiceClass();
