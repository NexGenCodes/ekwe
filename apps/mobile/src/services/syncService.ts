import { batch, observable } from "@legendapp/state";
import * as Crypto from "expo-crypto";

import { Db, type OutboxRow } from "@/services/db";
import {
  cloudRowToEntry,
  historyRowToEntry,
  legacyEntryDefaults,
} from "@/services/historyMapper";
import { mmkv as storage } from "@/services/mmkv";
import {
  buildDeleteAllOutboxPayload,
  buildDeleteOutboxPayload,
  buildUpsertOutboxPayload,
  parseSyncCursor,
} from "@/services/outboxPayload";

import { historyOutboxPayloadSchema } from "@ekwe/shared";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";

import { supabase } from "@/services/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { EntryType, HistoryEntry, history$, auth$ } from "@/store";
import { logger } from "@/utils";
import {
  checkIsOnline,
  isDefinitelyOffline,
  subscribeToNetwork,
} from "@/utils/connectivity";
import { HISTORY_LOCAL_TTL_DAYS } from "@/constants/retention";
import type { HistoryWriteFields } from "@/services/outboxPayload";

const INITIAL_HISTORY_SIZE = 20;
const MAX_HISTORY_CACHE = 1000;
const LOCAL_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DRAIN_TIMEOUT_MS = 15_000;
const REALTIME_RETRY_BASE_MS = 2_000;
const REALTIME_RETRY_MAX_MS = 60_000;
const REALTIME_MAX_RETRIES = 5;
/**
 * Jitter band for the realtime backoff, as a fraction of the base delay.
 * Matches the HTTP retry loop in `utils/http.ts` so both spread reconnect
 * storms the same way instead of each hammering on a different schedule.
 */
const REALTIME_RETRY_JITTER = 0.5;

/**
 * Whether a pending outbox payload is a whole-history delete.
 *
 * `clearAllHistory` enqueues a single row under a random UUID, so the guard for
 * its realtime echo has to recognise the payload, not the row id.
 */
function isDeleteAllPayload(payload: string): boolean {
  return readOutboxAction(payload) === "delete_all";
}

/** Whether a pending outbox payload deletes this specific row. */
function isDeletePayloadFor(payload: string, id: string): boolean {
  const parsed = readOutboxActionId(payload);
  return parsed.action === "delete" && parsed.id === id;
}

function readOutboxAction(payload: string): string | null {
  return readOutboxActionId(payload).action;
}

function readOutboxActionId(payload: string): {
  action: string | null;
  id?: string;
} {
  try {
    const parsed = JSON.parse(payload) as { action?: string; id?: string };
    return { action: parsed.action ?? null, id: parsed.id };
  } catch {
    // A malformed payload cannot be proven to be ours, so let the event
    // through rather than silently dropping a real remote delete.
    return { action: null };
  }
}

/**
 * Coerce anything thrown into a real `Error`.
 *
 * supabase-js rejects with a PostgREST error *plain object*
 * (`{ message, details, hint, code }`), not an `Error`. Every
 * `err instanceof Error` check therefore fails on the one class of failure we
 * most want to classify, which is how a drained batch reported
 * `Batch drain failed ` with no reason attached and skipped the timeout branch
 * entirely. Normalising at the boundary keeps the classification honest.
 */
function toError(err: unknown): Error {
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

const CLOUD_COLUMNS =
  "id, user_id, capture_id, origin, input, source_lang, target_lang, transcript, translation_text, transliteration_text, duration, source_app, voice_id, stt_provider, mt_provider, created_at, type";

type CloudRow = {
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
};

class SyncServiceClass {
  private unsubscribeNetInfo: (() => void) | null = null;
  private drainQueue: Promise<void> = Promise.resolve();
  private drainTimeout: NodeJS.Timeout | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private realtimeRetryAttempt = 0;
  private realtimeUserId: string | null = null;
  /**
   * Bumped on every join and on every teardown. A subscribe callback carries
   * the generation it was created under and is ignored once it is stale, which
   * is what stops a superseded channel from applying events or scheduling
   * retries against the current session.
   */
  private realtimeGeneration = 0;

  pullError = observable<string | null>(null);

  deadCount = observable(0);

  private refreshDeadCount(): void {
    this.deadCount.set(Db.countDeadOutbox(auth$.user.get()?.id ?? ""));
  }

  retryDeadOutbox(): Promise<void> {
    const revived = Db.reviveDeadOutbox();
    if (revived > 0) {
      logger.info("[Sync] Retrying", revived, "dead outbox rows");
    }
    return this.drain().finally(() => this.refreshDeadCount());
  }

  /**
   * Write one capture to history, inserting or updating as needed.
   *
   * A capture produces exactly one row. Transcribing calls this with a null
   * translation; translating later calls it again with the same `captureId` and
   * the row is updated in place. Keyed on the capture rather than on the
   * entry's text, because text cannot distinguish a capture from its own
   * translation — they share it by definition.
   */
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

    // Skip the lookup entirely when there is no capture id: legacy rows all
    // share a NULL, so asking for one could only ever match a row that does
    // not belong to this capture.
    const existing = payload.captureId
      ? Db.findByCaptureId(userId, payload.captureId)
      : null;
    if (existing) {
      // Preserve the original capture time: a translation arriving later must
      // not make the note look newer than it is, or it jumps to the top of a
      // list the user is already reading.
      const createdAt = existing.createdAt;

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

      // Through the batch drain, never a private single-row push. `pushToCloud`
      // read the pending outbox independently of `runDrain`, so a capture
      // rewritten while a batch was in flight was pushed twice, and its
      // failure path could bump the retry counter on a row the batch had
      // already deleted. Both writers now go through one serialized queue.
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
    Db.transaction(() => {
      Db.deleteHistory(id);
      Db.insertOutbox({
        id: Crypto.randomUUID(),
        payload: buildDeleteOutboxPayload(id),
        userId: userId,
        createdAt: created_at,
      });
    });

    history$[id].delete();

    this.scheduleDrain();
  }

  /** Undo support: put a deleted entry back exactly as it was. */
  async restoreHistory(rawEntry: HistoryEntry, userId: string): Promise<void> {
    const entry = legacyEntryDefaults(rawEntry);
    const created_at = new Date(entry.timestamp).toISOString();
    const type: EntryType = entry.translation ? "translation" : "transcription";

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

  clearSyncCursor(userId: string): void {
    storage.remove(`last-sync-${userId}`);
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

  scheduleDrain(): void {
    if (this.drainTimeout) clearTimeout(this.drainTimeout);
    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null;
      this.drain().catch((err) =>
        logger.error("[Sync] Scheduled drain failed", err),
      );
    }, 500);
  }

  drain(): Promise<void> {
    const next = this.drainQueue.then(
      () => this.runDrain(),
      () => this.runDrain(),
    );
    this.drainQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runDrain(): Promise<void> {
    let entries: OutboxRow[] = [];
    const attempted = new Set<string>();
    /**
     * Rows whose payload we could not read. They are counted in `entries` but
     * must not be deleted on success: the row may be a truncated write rather
     * than a corrupt one, and deleting it would drop the capture with no
     * record that it ever existed. They go back through the retry path and end
     * up `dead` — visible to the user — instead of vanishing.
     */
    const unparsed = new Set<string>();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DRAIN_TIMEOUT_MS);

    try {
      const userId = auth$.user.get()?.id;
      if (!userId) return;

      const online = await checkIsOnline();
      if (!online) return;

      entries = Db.getPendingOutbox(userId);
      if (entries.length === 0) return;

      logger.info(
        "[Sync] Draining",
        entries.length,
        "pending entries (batching)",
      );

      const toUpsert = [];
      const toDelete = [];
      let deleteAll = false;

      for (const entry of entries) {
        Db.markOutboxInFlight(entry.id);
        try {
          const parsed = historyOutboxPayloadSchema.safeParse(
            JSON.parse(entry.payload),
          );
          if (!parsed.success) {
            throw new Error(
              `Invalid outbox payload: ${
                parsed.error.issues[0]?.message ?? "unknown validation error"
              }`,
            );
          }
          const payload = parsed.data;
          attempted.add(entry.id);
          if (payload.action === "delete_all") {
            deleteAll = true;
          } else if (payload.action === "delete") {
            toDelete.push(payload.id || entry.id);
          } else {
            toUpsert.push({
              id: entry.id,
              user_id: entry.userId,
              type: payload.type,
              // A payload enqueued by an older app version has no capture
              // metadata. Fall back to the legacy shape rather than dropping
              // the row: `source_app` may hold an in-app sentinel that we no
              // longer write, and `origin` defaults to echo, which is correct
              // for every row that path produced.
              capture_id: payload.capture_id ?? null,
              origin: payload.origin ?? "echo",
              input: payload.input ?? "audio",
              source_lang: payload.source_lang,
              target_lang: payload.target_lang,
              transcript: payload.transcript,
              translation_text: payload.translation_text,
              transliteration_text: payload.transliteration_text,
              duration: payload.duration,
              source_app: payload.source_app ?? "",
              voice_id: payload.voice_id ?? null,
              stt_provider: payload.stt_provider ?? "",
              mt_provider: payload.mt_provider ?? null,
              created_at: payload.created_at,
            });
          }
        } catch (e) {
          logger.error("[Sync] Invalid payload in outbox", entry.id, e);
          unparsed.add(entry.id);
          Db.incrementOutboxRetry(entry.id);
        }
      }

      if (deleteAll) {
        const { error } = await supabase
          .from("history")
          .delete()
          .eq("user_id", userId)
          .abortSignal(controller.signal);
        if (error) throw toError(error);
      }

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from("history")
          .delete()
          .in("id", toDelete)
          .abortSignal(controller.signal);
        if (error) throw toError(error);
      }

      if (toUpsert.length > 0) {
        const { error } = await supabase
          .from("history")
          .upsert(toUpsert)
          .abortSignal(controller.signal);
        if (error) throw toError(error);
      }

      for (const entry of entries) {
        if (unparsed.has(entry.id)) continue;
        Db.deleteOutbox(entry.id);
      }
      logger.info(
        "[Sync] Batch pushed",
        toUpsert.length,
        "upserts,",
        toDelete.length,
        "deletes.",
      );

      // What is still queued after a *successful* push is either a row that
      // arrived mid-drain or a row that keeps being re-enqueued. Logging the
      // ids is the only way to tell those two apart from the outside, and it
      // is what turns "the drain log repeats" into an answerable question.
      const remaining = Db.getPendingOutbox(userId).filter(
        (row) => !unparsed.has(row.id),
      );
      if (remaining.length > 0) {
        logger.info(
          "[Sync] Outbox still queued after drain:",
          remaining.map((row) => row.id),
        );
      }
    } catch (rawErr) {
      const err = toError(rawErr);
      const isTimeout = err.name === "AbortError";
      logger.error(
        isTimeout
          ? "[Sync] Batch drain timed out, reverting in-flight rows"
          : "[Sync] Batch drain failed",
        err,
      );
      for (const id of attempted) {
        Db.incrementOutboxRetry(id);
      }
    } finally {
      clearTimeout(timeoutId);
      this.refreshDeadCount();
    }
  }

  async pullFromCloud(userId: string): Promise<void> {
    try {
      this.pullError.set(null);
      const lastSyncKey = `last-sync-${userId}`;
      const stored = storage.getString(lastSyncKey);

      let cursor = parseSyncCursor(stored);
      let totalPulled = 0;

      for (;;) {
        let query = supabase
          .from("history")
          .select(CLOUD_COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(200);

        if (cursor) {
          query = query.or(
            `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
          );
        }

        const { data, error } = await query;
        if (error) throw toError(error);
        if (!data || data.length === 0) break;

        const ttlCutoff =
          Date.now() - HISTORY_LOCAL_TTL_DAYS * 24 * 60 * 60 * 1000;

        batch(() => {
          for (const row of data as CloudRow[]) {
            if (new Date(row.created_at).getTime() < ttlCutoff) {
              continue;
            }

            const entry = cloudRowToEntry(row);
            const pending = Db.getPendingOutbox(userId).find(
              (r) => r.id === row.id,
            );

            Db.insertHistory({
              id: entry.id,
              userId: row.user_id,
              captureId: entry.captureId,
              origin: entry.origin,
              input: entry.input,
              sourceLang: entry.sourceLang,
              targetLang: entry.targetLang,
              transcript: entry.transcript,
              translationText: entry.translation,
              transliterationText: entry.transliteration,
              duration: entry.duration,
              sourceApp: entry.sourceApp ?? "",
              voiceId: entry.voiceId,
              sttProvider: entry.sttProvider,
              mtProvider: entry.mtProvider,
              createdAt: row.created_at,
              entryType: entry.type ?? "transcription",
            });

            if (!history$[row.id].get()) {
              history$[row.id].set(entry);
            } else if (!pending) {
              // Keep whatever the local capture recorded about where it came
              // from, and take the cloud's text — a translation may have been
              // added on another device.
              history$[row.id].set({
                ...history$[row.id].get(),
                transcript: entry.transcript,
                translation: entry.translation,
                transliteration: entry.transliteration,
                mtProvider: entry.mtProvider,
              });
              Db.updateCaptureRow(row.id, {
                transcript: entry.transcript,
                translation_text: entry.translation,
                transliteration_text: entry.transliteration ?? null,
                duration: entry.duration,
                source_app: entry.sourceApp,
                voice_id: entry.voiceId,
                stt_provider: entry.sttProvider,
                mt_provider: entry.mtProvider,
                origin: entry.origin,
                input: entry.input,
              });
            }
          }
        });

        // Save cursor after each page so a mid-pull crash
        // won't re-download the same rows on next boot.
        const newest = data[data.length - 1];
        cursor = { created_at: newest.created_at, id: newest.id };
        storage.set(lastSyncKey, JSON.stringify(cursor));

        totalPulled += data.length;
        if (data.length < 200) break;
      }

      if (totalPulled > 0) {
        this.trimHistoryWindow();
        logger.info("[Sync] Pulled", totalPulled, "entries from cloud");
      }
    } catch (rawErr) {
      const err = toError(rawErr);
      this.pullError.set(err.message);
      logger.error("[Sync] Pull from cloud failed", err);
    }
  }

  async fetchOlderHistory(
    userId: string,
    before: { created_at: string; id: string } | null,
    limit: number,
  ): Promise<HistoryEntry[]> {
    try {
      let query = supabase
        .from("history")
        .select(CLOUD_COLUMNS)
        .eq("user_id", userId);

      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (error) throw toError(error);

      return (data ?? []).map((row: CloudRow) => cloudRowToEntry(row));
    } catch (err) {
      logger.error("[Sync] fetchOlderHistory failed", err);
      return [];
    }
  }

  private pruneObservableExpired(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const record = history$.get() || {};
    for (const key of Object.keys(record)) {
      if (record[key].timestamp < cutoff) {
        history$[key].delete();
      }
    }
  }

  private runLocalCleanup(): void {
    const userId = auth$.user.get()?.id;
    const expired = Db.cleanupExpiredHistory(HISTORY_LOCAL_TTL_DAYS, userId);
    if (expired > 0) {
      logger.info("[Sync] Cleaned up", expired, "expired local history rows");
      this.pruneObservableExpired(HISTORY_LOCAL_TTL_DAYS);
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

  loadInitialHistory(userId?: string): void {
    history$.set({});
    if (!userId) return;
    const rows = Db.getRecentHistory(userId, INITIAL_HISTORY_SIZE);
    for (const row of rows) {
      history$[row.id].set(historyRowToEntry(row));
    }
  }

  async start(): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.clearCleanupTimer();

    this.runLocalCleanup();

    const currentUserId = auth$.user.get()?.id;
    this.loadInitialHistory(currentUserId);

    const revived = Db.reviveInFlight();
    this.refreshDeadCount();
    if (revived > 0) {
      logger.info(
        "[Sync] Revived",
        revived,
        "in-flight outbox rows (crash recovery)",
      );
      this.scheduleDrain();
    }

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (!isOnline) return;
      this.scheduleDrain();
      // Reconnecting is a fresh start for realtime. The reason we are not
      // subscribed is most likely the outage we just sat through, so reset the
      // retry budget instead of waiting for the next sign-in — otherwise the
      // retry cap is spent during one bad network window and the client stays
      // pull-only for the rest of the session.
      const userId = this.realtimeUserId;
      if (userId) {
        this.startRealtimeListener(userId).catch((err) =>
          logger.error("[Sync] Realtime join after reconnect failed", err),
        );
      }
    });

    this.cleanupTimer = setInterval(() => {
      this.runLocalCleanup();
    }, LOCAL_CLEANUP_INTERVAL_MS);
  }

  onUserSignedIn(userId: string): void {
    this.loadInitialHistory(userId);
    this.startRealtimeListener(userId).catch((err) =>
      logger.error("[Sync] onUserSignedIn realtime subscribe failed", err),
    );
    this.pullFromCloud(userId).catch((err) =>
      logger.error("[Sync] onUserSignedIn pullFromCloud failed", err),
    );
    this.drain().catch((err) =>
      logger.error("[Sync] onUserSignedIn drain failed", err),
    );
  }

  onUserSignedOut(): void {
    this.stopRealtimeListener();
    this.deadCount.set(0);
  }

  /**
   * Subscribe to Supabase Realtime for instant cross-device sync.
   * When another device inserts, updates, or deletes a history row,
   * the change is applied to the local SQLite DB and Legend State
   * store immediately — no polling required.
   */
  private async startRealtimeListener(userId: string): Promise<void> {
    // Only a genuine sign-in clears the failure history. The retry timer calls
    // `joinRealtime` directly precisely so that it does NOT reset this counter
    // and the backoff keeps growing across attempts.
    //
    // The pending timer is dropped here too. It only gets cleared on a
    // successful SUBSCRIBED, so without this a timer left over from an earlier
    // failure could fire against the counter this method is about to reset and
    // restart the backoff at the floor — the same class of bug this split was
    // meant to close.
    this.clearRealtimeRetry();
    this.realtimeRetryAttempt = 0;
    await this.joinRealtime(userId);
  }

  /**
   * Join, or re-join, the realtime channel.
   *
   * Must not touch `realtimeRetryAttempt` — see `startRealtimeListener`.
   */
  private async joinRealtime(userId: string): Promise<void> {
    const generation = ++this.realtimeGeneration;

    // Claimed before the await so a sign-out landing mid-handshake cancels the
    // join instead of leaving a channel subscribed behind a dead session.
    this.realtimeUserId = userId;

    // `removeChannel` is async. Awaiting it before subscribing is what keeps
    // two channels from being live at once: a second subscribed channel
    // receives every broadcast, so each row would be applied — and logged —
    // once per channel. Re-joining without awaiting is what produced duplicate
    // DELETE handling.
    const detached = this.teardownRealtimeChannel();
    if (detached) await detached;
    if (!this.isCurrentRealtimeJoin(userId, generation)) return;

    // Realtime authorizes postgres_changes from the JWT on the socket. If we
    // join without a session, supabase-js falls back to the anon key
    // (_getAccessToken -> ?? this.supabaseKey), the server authorizes the
    // subscription as `anon`, RLS denies it, and the channel errors out. So
    // only ever join with a real access token, and set it explicitly rather
    // than relying on listener ordering with onAuthStateChange.
    const { data } = await supabase.auth.getSession();
    if (!this.isCurrentRealtimeJoin(userId, generation)) {
      logger.info("[Sync] Realtime join cancelled — signed out mid-handshake");
      return;
    }

    const token = data.session?.access_token;
    if (!token) {
      logger.info(
        "[Sync] Skipping realtime subscribe — no session yet for",
        userId,
      );
      return;
    }

    await supabase.realtime.setAuth(token);
    if (!this.isCurrentRealtimeJoin(userId, generation)) return;

    this.realtimeChannel = supabase
      .channel(`history:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as CloudRow;
          // Skip if this row is still in our local outbox (we wrote it).
          const pending = Db.getPendingOutbox(userId);
          if (pending.some((p) => p.id === row.id)) return;

          const entry = cloudRowToEntry(row);
          Db.insertHistory({
            id: entry.id,
            userId: row.user_id,
            captureId: entry.captureId,
            origin: entry.origin,
            input: entry.input,
            sourceLang: entry.sourceLang,
            targetLang: entry.targetLang,
            transcript: entry.transcript,
            translationText: entry.translation,
            transliterationText: entry.transliteration,
            duration: entry.duration,
            sourceApp: entry.sourceApp ?? "",
            voiceId: entry.voiceId,
            sttProvider: entry.sttProvider,
            mtProvider: entry.mtProvider,
            createdAt: row.created_at,
            entryType: entry.type ?? "transcription",
          });

          history$[row.id].set(entry);
          logger.info("[Sync] Realtime INSERT received", row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as CloudRow;
          const pending = Db.getPendingOutbox(userId);
          if (pending.some((p) => p.id === row.id)) return;

          const entry = cloudRowToEntry(row);
          // A translation added on another device. Preserve the local origin
          // and capture time — the cloud row knows them, but a legacy row's
          // default is not worth overwriting a real value with.
          const existing = history$[row.id].get();
          history$[row.id].set({
            ...entry,
            origin: existing?.origin ?? entry.origin,
            captureId: existing?.captureId ?? entry.captureId,
            timestamp: existing?.timestamp ?? entry.timestamp,
          });

          Db.updateCaptureRow(row.id, {
            transcript: entry.transcript,
            translation_text: entry.translation,
            transliteration_text: entry.transliteration ?? null,
            duration: entry.duration,
            source_app: entry.sourceApp,
            voice_id: entry.voiceId,
            stt_provider: entry.sttProvider,
            mt_provider: entry.mtProvider,
            origin: entry.origin,
            input: entry.input,
          });
          logger.info("[Sync] Realtime UPDATE received", row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const oldRow = payload.old as { id?: string };
          if (!oldRow.id) return;
          const deletedId = oldRow.id;
          // Same echo guard the INSERT/UPDATE handlers use, but keyed on the
          // outbox payload rather than the row id. `clearAllHistory` enqueues
          // one outbox row under a random UUID carrying `delete_all`, so
          // `p.id === oldRow.id` can never match it — yet its own DELETE
          // broadcast comes back to us for every row it removed. Re-applying
          // those is redundant work against rows the local purge already
          // removed, so skip them while the delete is still in flight.
          const pending = Db.getPendingOutbox(userId);
          if (
            pending.some(
              (p) =>
                p.id === deletedId ||
                isDeleteAllPayload(p.payload) ||
                isDeletePayloadFor(p.payload, deletedId),
            )
          ) {
            return;
          }
          Db.deleteHistory(deletedId);
          history$[deletedId].delete();
          logger.info("[Sync] Realtime DELETE received", deletedId);
        },
      )
      .subscribe((status, err) => {
        // A superseded channel still has callbacks owed to it. Acting on them
        // would apply events for the wrong session and spend retry budget that
        // belongs to the channel that is actually live.
        if (generation !== this.realtimeGeneration) {
          logger.info(
            "[Sync] Ignoring status from superseded realtime channel:",
            status,
          );
          return;
        }
        logger.info("[Sync] Realtime subscription status:", status);
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          this.realtimeRetryAttempt = 0;
          this.clearRealtimeRetry();
          return;
        }
        // CLOSED joins CHANNEL_ERROR and TIMED_OUT as recoverable. The usual
        // causes are a transient socket failure, a token that expired between
        // setAuth and join, or the realtime server not being reachable yet at
        // cold start. Back off and re-join so a dropped socket does not
        // silently downgrade the client to pull-only sync. CLOSED used to fall
        // through unmatched, so that downgrade was permanent and silent.
        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          logger.error(
            "[Sync] Realtime subscribe failed:",
            status,
            err instanceof Error ? err.message : String(err ?? ""),
          );
          this.scheduleRealtimeRetry();
        }
      });
  }

  /**
   * True while `generation` is still the newest join and `userId` is still the
   * signed-in user. Guards every await boundary in the handshake.
   */
  private isCurrentRealtimeJoin(userId: string, generation: number): boolean {
    return (
      this.realtimeUserId === userId && this.realtimeGeneration === generation
    );
  }

  /**
   * Remove the current channel, if any, and hand back the detach promise.
   *
   * Returns `null` when there was nothing to remove, so the common first-join
   * path stays synchronous up to the next real await instead of paying a
   * microtask tick for an empty teardown.
   *
   * Does not bump the generation or clear `realtimeUserId` — the caller owns
   * that decision, because a re-join must be able to keep its own generation.
   */
  private teardownRealtimeChannel(): Promise<void> | null {
    const channel = this.realtimeChannel;
    this.realtimeChannel = null;
    if (!channel) return null;
    // `Promise.resolve` is load-bearing, not ceremony: `removeChannel` can hand
    // back a non-promise (or nothing at all) for an already-detached channel,
    // and calling `.catch` on that throws inside the teardown.
    //
    // The cast keeps the resolved value out of the signature without a trailing
    // `.then`, which would add a microtask to every re-join's teardown.
    return Promise.resolve(supabase.removeChannel(channel)).catch((err) => {
      // A channel that refuses to detach must not abort the re-join; the
      // generation guard already neutralises its callbacks.
      logger.warn("[Sync] removeChannel failed, continuing", err);
    }) as Promise<void>;
  }

  private clearRealtimeRetry(): void {
    if (this.realtimeRetryTimeout) {
      clearTimeout(this.realtimeRetryTimeout);
      this.realtimeRetryTimeout = null;
    }
  }

  private scheduleRealtimeRetry(): void {
    if (this.realtimeRetryTimeout) return;
    const userId = this.realtimeUserId;
    if (!userId) return;

    // Being offline is not a provider failure, and spending a retry on a dead
    // network only walks us toward the cap while the user is in a tunnel. The
    // network subscription re-arms realtime on reconnect.
    if (isDefinitelyOffline()) {
      logger.info(
        "[Sync] Offline — holding realtime retry until reconnect rather than spending the budget",
      );
      return;
    }

    this.realtimeRetryAttempt += 1;
    if (this.realtimeRetryAttempt > REALTIME_MAX_RETRIES) {
      logger.error(
        "[Sync] Realtime gave up after",
        REALTIME_MAX_RETRIES,
        "attempts — history will sync on next sign-in or pull",
      );
      return;
    }

    const base = Math.min(
      REALTIME_RETRY_BASE_MS * 2 ** (this.realtimeRetryAttempt - 1),
      REALTIME_RETRY_MAX_MS,
    );
    const delay = Math.round(
      base *
        (1 - REALTIME_RETRY_JITTER + Math.random() * REALTIME_RETRY_JITTER),
    );
    logger.info("[Sync] Retrying realtime subscribe in", delay, "ms");
    this.realtimeRetryTimeout = setTimeout(() => {
      this.realtimeRetryTimeout = null;
      if (this.realtimeUserId !== userId) return;
      // `joinRealtime`, not `startRealtimeListener`: resetting the counter here
      // is what pinned the delay at 2s forever and made the cap unreachable.
      this.joinRealtime(userId).catch((err) =>
        logger.error("[Sync] Realtime retry failed", err),
      );
    }, delay);
  }

  private stopRealtimeListener(): void {
    this.clearRealtimeRetry();
    // Invalidate in-flight joins and any callback the outgoing channel still
    // owes us, so a sign-out cannot be undone by a late subscribe status.
    this.realtimeGeneration += 1;
    this.realtimeUserId = null;
    this.realtimeRetryAttempt = 0;
    void this.teardownRealtimeChannel();
  }

  stop(): void {
    this.clearCleanupTimer();
    this.stopRealtimeListener();
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const SyncService = new SyncServiceClass();
