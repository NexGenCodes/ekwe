import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { addCorsHeaders, getCorsHeaders } from "@/core/cors";
import { error } from "@/core/http";
import { logger } from "@/core/logger";
import { runPipeline } from "@/core/pipeline";
import type { Env } from "@/core/types";
import { d1Cleanup } from "@/services/d1-cache";
import { supabasePost } from "@/services/supabase";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";
import { routes } from "@/routes/table";

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
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "cleanup_expired_history" });
    logger.info("[scheduled] Enqueued cleanup_expired_history");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue maintenance task", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await env.MAINTENANCE_QUEUE.send({ type: "reconcile_flutterwave" });
    logger.info("[scheduled] Enqueued reconcile_flutterwave");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue reconcile_flutterwave", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createWorker() {
  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      try {
        return await runPipeline(request, env, ctx, routes);
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.error("[global] Unhandled exception", { error: errorMsg });
        const corsHeaders = getCorsHeaders(request, env);
        return addCorsHeaders(
          error(
            WORKER_ERROR_CODES.EKWE_SERVER_ERROR,
            500,
            "An unexpected error occurred.",
          ),
          corsHeaders,
        );
      }
    },

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
          const res = await supabasePost(
            env,
            "/rest/v1/rpc/cleanup_expired_history",
            "{}",
          );

          if (!res) {
            logger.error("[queue] Missing Supabase credentials");
            throw new Error("Missing Supabase credentials");
          }

          if (!res.ok) {
            const body = await res.text();
            logger.error("[queue] cleanup_expired_history failed", {
              status: res.status,
              body: body.slice(0, 500),
            });
            throw new Error(`cleanup_expired_history failed: ${res.status}`);
          }

          const result = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          logger.info("[queue] cleanup_expired_history completed", result);
        } else if (body?.type === "reconcile_flutterwave") {
          await reconcileFlutterwaveTransactions(env);
        }
      }
    },
  } satisfies ExportedHandler<Env>;
}
