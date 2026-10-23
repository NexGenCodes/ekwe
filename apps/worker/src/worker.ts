import type { Env } from "@/core/types";
import { runMaintenance } from "@/services/maintenance";
import { app } from "@/app";

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
  } satisfies ExportedHandler<Env>;
}
