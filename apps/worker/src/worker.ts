import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { d1Cleanup } from "@/services/d1-cache";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { sql } from "drizzle-orm";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";
import { purgeExpiredSpeechCache } from "@/services/speech";
import { app } from "@/app";

const MAINTENANCE_DLQ_NAME = "ekwe-maintenance-dlq";

async function runMaintenance(env: Env): Promise<void> {
  if (env.EKWE_D1) {
    try {
      await d1Cleanup(env.EKWE_D1, "cache_translation");
      await d1Cleanup(env.EKWE_D1, "cache_transcription");
      await d1Cleanup(env.EKWE_D1, "cache_lang");
      await d1Cleanup(env.EKWE_D1, "webhook_idempotency");
      logger.info("[scheduled] D1 cache cleanup completed");
    } catch (err) {
      logger.error("[scheduled] D1 cache cleanup failed", {
        error: describeError(err),
      });
    }
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "cleanup_expired_history" });
    logger.info("[scheduled] Enqueued cleanup_expired_history");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue maintenance task", {
      error: describeError(err),
    });
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "reconcile_flutterwave" });
    logger.info("[scheduled] Enqueued reconcile_flutterwave");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue reconcile_flutterwave", {
      error: describeError(err),
    });
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "purge_tombstones" });
    logger.info("[scheduled] Enqueued purge_tombstones");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue purge_tombstones task", {
      error: describeError(err),
    });
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "purge_expired_speech_cache" });
    logger.info("[scheduled] Enqueued purge_expired_speech_cache");
  } catch (err) {
    logger.error(
      "[scheduled] Failed to enqueue purge_expired_speech_cache task",
      {
        error: describeError(err),
      },
    );
  }
}

export function createWorker() {
  return {
    fetch: app.fetch,

    scheduled(
      _controller: ScheduledController,
      env: Env,
      ctx: ExecutionContext,
    ): void {
      ctx.waitUntil(runMaintenance(env));
    },

    async queue(
      batch: MessageBatch<unknown>,
      env: Env,
      _ctx: ExecutionContext,
    ): Promise<void> {
      if (batch.queue === MAINTENANCE_DLQ_NAME) {
        for (const msg of batch.messages) {
          const body = msg.body as { type?: string } | null;
          logger.error("[queue][dlq] Maintenance task permanently failed", {
            type: body?.type ?? "unknown",
            attempts: msg.attempts,
          });
          msg.ack();
        }
        return;
      }
      for (const msg of batch.messages) {
        const body = msg.body as { type: string } | null;
        if (body?.type === "cleanup_expired_history") {
          try {
            const result = await retryOnConnectionLoss(
              (client) =>
                client.execute(sql`SELECT * FROM cleanup_expired_history()`),
              env,
            );
            const row = result[0] ?? {};
            logger.info("[queue] cleanup_expired_history completed", row);
          } catch (err) {
            logger.error("[queue] cleanup_expired_history failed", {
              error: describeError(err),
            });
            throw err;
          }
        } else if (body?.type === "reconcile_flutterwave") {
          await reconcileFlutterwaveTransactions(env);
        } else if (body?.type === "purge_tombstones") {
          try {
            const result = await retryOnConnectionLoss(
              (client) =>
                client.transaction(async (tx) => {
                  // The function refuses callers whose `role` setting is not
                  // service_role. Hyperdrive connects as the project owner, so
                  // `role` is unset, unlike PostgREST which sets it per request.
                  // Scoped to this transaction so the pooled connection leaves
                  // with its original role.
                  await tx.execute(sql`SET LOCAL role = 'service_role'`);
                  return tx.execute(
                    sql`SELECT * FROM history_purge_tombstones()`,
                  );
                }),
              env,
            );
            logger.info("[queue] purge_tombstones completed", {
              purged: result[0]?.history_purge_tombstones,
            });
          } catch (err) {
            logger.error("[queue] purge_tombstones failed", {
              error: describeError(err),
            });
            throw err;
          }
        } else if (body?.type === "purge_expired_speech_cache") {
          try {
            const deleted = await purgeExpiredSpeechCache(env);
            logger.info("[queue] purge_expired_speech_cache completed", {
              deleted,
            });
          } catch (err) {
            logger.error("[queue] purge_expired_speech_cache failed", {
              error: describeError(err),
            });
            throw err;
          }
        }
      }
    },
  } satisfies ExportedHandler<Env>;
}
