import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { d1Cleanup } from "@/services/d1-cache";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { sql } from "drizzle-orm";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";
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
        }
      }
    },
  } satisfies ExportedHandler<Env>;
}
