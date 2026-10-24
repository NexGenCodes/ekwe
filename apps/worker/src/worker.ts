import type { Env } from "@/core/types";
import { runMaintenance } from "@/services/maintenance";
import { app } from "@/app";
import { handleWebhookQueue } from "@/services/webhook-queue";

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

    /**
     * Cloudflare Queue consumer for `ekwe-webhook-retry`.
     *
     * `ExportedHandler<Env>` types the queue handler as `MessageBatch<unknown>`,
     * so the batch is widened here and cast to the concrete type inside
     * `handleWebhookQueue`.
     */
    queue(
      batch: MessageBatch<unknown>,
      env: Env,
      _ctx: ExecutionContext,
    ): Promise<void> {
      return handleWebhookQueue(
        batch as Parameters<typeof handleWebhookQueue>[0],
        env,
      );
    },
  } satisfies ExportedHandler<Env>;
}
