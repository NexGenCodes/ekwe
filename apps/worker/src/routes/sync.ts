import type { Context } from "hono";
import type { AppEnv } from "@/app";
import type { HistoryRow } from "@ekwe/shared";
import type { Env } from "@/core/types";
import {
  SYNC_PULL_ROWS,
  SYNC_PUSH_COOLDOWN_MS,
  WORKER_ERROR_CODES,
  syncPullRequestSchema,
  syncPushRequestSchema,
  syncPushRows,
} from "@ekwe/shared";
import { claimSyncPush } from "@/services/preflight";
import { error } from "@/core/http";
import { readJson } from "@/core/validate";
import { logger } from "@/core/logger";
import { describeError, retryTransient } from "@/db/retry";

const SELECT_COLUMNS = `id, type, capture_id, origin, input, source_lang,
  target_lang, transcript, translation_text, transliteration_text, duration,
  source_app, voice_id, stt_provider, mt_provider, created_at, updated_at,
  revision, deleted_at`;

interface HistoryDbRow {
  id: string;
  type: string;
  capture_id: string | null;
  origin: string;
  input: string;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  transliteration_text: string | null;
  duration: number;
  source_app: string;
  voice_id: string | null;
  stt_provider: string;
  mt_provider: string | null;
  created_at: number;
  updated_at: number;
  revision: number;
  deleted_at: number | null;
}

function toWire(row: HistoryDbRow) {
  return {
    id: row.id,
    type: row.type,
    captureId: row.capture_id,
    origin: row.origin,
    input: row.input,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    transcript: row.transcript,
    translationText: row.translation_text,
    transliterationText: row.transliteration_text,
    duration: row.duration,
    sourceApp: row.source_app,
    voiceId: row.voice_id,
    sttProvider: row.stt_provider,
    mtProvider: row.mt_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    deletedAt: row.deleted_at,
  };
}

type Cursor = { updatedAt: number; id: string } | null | "invalid";

function parseCursor(cursor: string | null | undefined): Cursor {
  if (!cursor) return null;

  const separator = cursor.indexOf(":");
  if (separator <= 0) return "invalid";

  const updatedAt = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isInteger(updatedAt) || !id) return "invalid";

  return { updatedAt, id };
}

export async function handlePull(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson(c, syncPullRequestSchema);
  if (body instanceof Response) return body;

  const cursor = parseCursor(body.cursor);
  if (cursor === "invalid") return error(WORKER_ERROR_CODES.INVALID_BODY, 400);

  const limit = body.limit ?? SYNC_PULL_ROWS;
  const userId = c.get("auth")!.userId;

  const statement = cursor
    ? c.env.DB.prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM history
          WHERE user_id = ?
            AND (updated_at > ? OR (updated_at = ? AND id > ?))
          ORDER BY updated_at ASC, id ASC
          LIMIT ?`,
      ).bind(userId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1)
    : c.env.DB.prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM history
          WHERE user_id = ?
          ORDER BY updated_at ASC, id ASC
          LIMIT ?`,
      ).bind(userId, limit + 1);

  try {
    const { results } = await retryTransient(() =>
      statement.all<HistoryDbRow>(),
    );

    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    const last = page[page.length - 1];

    return Response.json({
      rows: page.map(toWire),
      nextCursor: last
        ? `${last.updated_at}:${last.id}`
        : (body.cursor ?? null),
      hasMore,
    });
  } catch (err) {
    logger.error("[sync] pull failed", { error: describeError(err) });
    return error(WORKER_ERROR_CODES.SERVICE_UNAVAILABLE, 503);
  }
}

type PushStatus = "ok" | "conflict" | "deleted" | "not_found";

interface PushOutcome {
  id: string;
  status: PushStatus;
  revision?: number;
  /** Present on `conflict`: the server's current row, for an immediate rebase. */
  row?: ReturnType<typeof toWire>;
}

function buildUpsert(
  db: D1Database,
  userId: string,
  row: HistoryRow,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO history (
         id, user_id, type, capture_id, origin, input, source_lang, target_lang,
         transcript, translation_text, transliteration_text, duration,
         source_app, voice_id, stt_provider, mt_provider, created_at,
         updated_at, revision, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (id) DO UPDATE SET
         type = excluded.type,
         capture_id = excluded.capture_id,
         origin = excluded.origin,
         input = excluded.input,
         source_lang = excluded.source_lang,
         target_lang = excluded.target_lang,
         transcript = excluded.transcript,
         translation_text = excluded.translation_text,
         transliteration_text = excluded.transliteration_text,
         duration = excluded.duration,
         source_app = excluded.source_app,
         voice_id = excluded.voice_id,
         stt_provider = excluded.stt_provider,
         mt_provider = excluded.mt_provider,
         updated_at = excluded.updated_at,
         revision = history.revision + 1,
         deleted_at = excluded.deleted_at
       WHERE history.user_id = excluded.user_id
         AND history.revision = ?
         AND (history.deleted_at IS NULL OR ? = 1)
       RETURNING revision`,
    )
    .bind(
      row.id,
      userId,
      row.type,
      row.captureId ?? null,
      row.origin,
      row.input,
      row.sourceLang,
      row.targetLang,
      row.transcript,
      row.translationText ?? null,
      row.transliterationText ?? null,
      row.duration,
      row.sourceApp,
      row.voiceId ?? null,
      row.sttProvider,
      row.mtProvider ?? null,
      row.createdAt,
      now,
      row.deletedAt ?? null,
      row.revision,
      row.restore ? 1 : 0,
    );
}

function pushCooldownMs(env: Env): number {
  const raw = env.SYNC_PUSH_COOLDOWN_MS;
  if (raw === undefined) return SYNC_PUSH_COOLDOWN_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : SYNC_PUSH_COOLDOWN_MS;
}

export async function handlePush(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson(c, syncPushRequestSchema);
  if (body instanceof Response) return body;

  const maxRows = syncPushRows(
    (c.env.WORKERS_PAID as string | undefined) === "true",
  );
  if (body.rows.length > maxRows) {
    return error(
      WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE,
      413,
      `Up to ${maxRows} history rows per push.`,
    );
  }

  const userId = c.get("auth")!.userId;

  const cooldownMs = pushCooldownMs(c.env);
  if (cooldownMs > 0) {
    let retryAfter: number | null;
    try {
      retryAfter = await claimSyncPush(c.env, userId, cooldownMs);
    } catch (err) {
      logger.error("[sync] push cooldown failed", {
        error: describeError(err),
      });
      return error(WORKER_ERROR_CODES.SERVICE_UNAVAILABLE, 503);
    }
    if (retryAfter !== null) {
      return error(
        WORKER_ERROR_CODES.EKWE_RATE_LIMIT,
        429,
        `Please wait ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
        { headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  const now = Date.now();
  const statements = body.rows.map((row) =>
    buildUpsert(c.env.DB, userId, row, now),
  );

  let batch: D1Result[];
  try {
    batch = await retryTransient(() => c.env.DB.batch(statements));
  } catch (err) {
    logger.error("[sync] push failed", { error: describeError(err) });
    return error(WORKER_ERROR_CODES.SERVICE_UNAVAILABLE, 503);
  }

  const missed: number[] = [];
  const outcomes: PushOutcome[] = body.rows.map((row, index) => {
    const returned = (batch[index]?.results ?? []) as { revision: number }[];
    if (returned.length > 0) {
      return { id: row.id, status: "ok", revision: returned[0].revision };
    }
    missed.push(index);
    return { id: row.id, status: "not_found" };
  });

  if (missed.length > 0) {
    const placeholders = missed.map(() => "?").join(", ");
    const ids = missed.map((index) => body.rows[index].id);

    try {
      const { results } = await retryTransient(() =>
        c.env.DB.prepare(
          `SELECT ${SELECT_COLUMNS}
             FROM history
            WHERE user_id = ? AND id IN (${placeholders})`,
        )
          .bind(userId, ...ids)
          .all<HistoryDbRow>(),
      );

      const server = new Map(results.map((row) => [row.id, row]));

      for (const index of missed) {
        const id = body.rows[index].id;
        const row = server.get(id);
        outcomes[index] = !row
          ? { id, status: "not_found" }
          : row.deleted_at !== null
            ? { id, status: "deleted", revision: row.revision }
            : {
                id,
                status: "conflict",
                revision: row.revision,
                // The client rebases without waiting for its next pull.
                row: toWire(row),
              };
      }
    } catch (err) {
      logger.error("[sync] conflict lookup failed", {
        error: describeError(err),
      });
      return error(WORKER_ERROR_CODES.SERVICE_UNAVAILABLE, 503);
    }
  }

  return Response.json({ results: outcomes, serverTime: now });
}
