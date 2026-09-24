import { WORKER_ERROR_CODES } from "@ekwe/shared";
import {
  guardAutoDetect,
  guardLanguageCode,
  guardStreamingAllowed,
  guardWebSocketUpgrade,
} from "@/core/guards";
import {
  runPipeline,
  type AppRoute,
  type AuthedRouteHandler,
  type RouteHandler,
} from "@/core/pipeline";
import { addCorsHeaders, getCorsHeaders } from "@/core/cors";
import { error } from "@/core/http";
import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { d1Cleanup } from "@/services/d1-cache";
import { supabasePost } from "@/services/supabase";
import { handleTranscribe } from "@/routes/transcribe";
import { handleTranslate } from "@/routes/translate";
import { handleSynthesize } from "@/routes/synthesize";
import { handleStorePricing } from "@/routes/pricing";
import { handleUsage } from "@/routes/usage";
import { handleWebhook } from "@/routes/webhook";

import {
  handleCheckout,
  handleVerifyTransaction,
  handleBillingFlags,
} from "@/routes/billing";
import { handleSendOtp } from "@/routes/otp";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import {
  handleUpdateNotify,
  handleGetUpdateManifest,
  handlePostUpdateManifest,
} from "@/routes/admin";
import { type OptionalAuthedRouteHandler } from "@/core/pipeline";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";
import { isProviderDegraded } from "@/services/health";
import { PROVIDER_MODULES } from "@/providers";

const MAINTENANCE_DLQ_NAME = "ekwe-maintenance-dlq";

const healthHandler: RouteHandler = async (rctx) => {
  const degraded: string[] = [];
  for (const name of Object.keys(PROVIDER_MODULES)) {
    if (await isProviderDegraded(rctx.env, name)) degraded.push(name);
  }

  let d1 = "ok";
  try {
    await rctx.env.EKWE_D1.prepare("SELECT 1").bind().first();
  } catch {
    d1 = "error";
  }
  let kv = "ok";
  try {
    await rctx.env.EKWE_KV.get("health:probe", { type: "text" });
  } catch {
    kv = "error";
  }

  return Response.json({
    status: "ok",
    timestamp: Date.now(),
    degradedProviders: degraded,
    bindings: { d1, kv },
  });
};

const storePricingHandler: RouteHandler = (rctx) =>
  handleStorePricing(rctx.request, rctx.env, rctx.ctx);

const webhookHandler: RouteHandler = (rctx) =>
  handleWebhook(rctx.request, rctx.env, rctx.ctx);

const checkoutHandler: AuthedRouteHandler = (rctx) =>
  handleCheckout(rctx.request, rctx.env, rctx.auth);

const verifyTransactionHandler: AuthedRouteHandler = (rctx) =>
  handleVerifyTransaction(rctx.request, rctx.env, rctx.auth);

const billingFlagsHandler: RouteHandler = (rctx) =>
  handleBillingFlags(rctx.request, rctx.env);

const otpHandler: RouteHandler = (rctx) =>
  handleSendOtp(rctx.request, rctx.env);

const streamHandler: AuthedRouteHandler = (rctx) => {
  const { request, env } = rctx;
  const { userId, tier, sessionId } = rctx.auth;

  const upgradeGuard = guardWebSocketUpgrade(request);
  if (upgradeGuard) return upgradeGuard;

  const streamingGuard = guardStreamingAllowed(tier);
  if (!streamingGuard.allowed) return streamingGuard.response;

  const streamUrl = new URL(request.url);
  const streamLang = streamUrl.searchParams.get("lang") || "en";

  const autoGuard = guardAutoDetect(streamLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(streamLang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  const doUrl = new URL(request.url);
  doUrl.searchParams.set("tier", tier);
  if (sessionId) doUrl.searchParams.set("sid", sessionId);
  const stub = env.STREAM_DO.getByName(userId) as unknown as DurableObjectStub;
  return stub.fetch(new Request(doUrl.toString(), request));
};

const usageHandler: AuthedRouteHandler = (rctx) =>
  handleUsage(rctx.env, rctx.auth.userId, rctx.auth.tier);

const transcribeHandler: AuthedRouteHandler = (rctx) =>
  handleTranscribe(
    rctx.request,
    rctx.env,
    rctx.auth.tier,
    rctx.request.signal,
    rctx.auth.userId,
    rctx.ctx,
  );

const translateHandler: AuthedRouteHandler = (rctx) =>
  handleTranslate(
    rctx.request,
    rctx.env,
    rctx.auth.tier,
    rctx.request.signal,
    rctx.auth.userId,
    rctx.ctx,
  );

const synthesizeHandler: AuthedRouteHandler = (rctx) =>
  handleSynthesize(
    rctx.request,
    rctx.env,
    rctx.auth.tier,
    rctx.request.signal,
    { userId: rctx.auth.userId, sessionId: rctx.auth.sessionId },
    rctx.ctx,
  );

const registerDeviceTokenHandler: OptionalAuthedRouteHandler = (rctx) =>
  handleRegisterDeviceToken(rctx.request, rctx.env, rctx.auth);

const updateNotifyHandler: RouteHandler = (rctx) =>
  handleUpdateNotify(rctx.request, rctx.env);

const getUpdateManifestHandler: RouteHandler = (rctx) =>
  handleGetUpdateManifest(rctx.request, rctx.env, rctx.ctx);

const postUpdateManifestHandler: RouteHandler = (rctx) =>
  handlePostUpdateManifest(rctx.request, rctx.env);

const routes: AppRoute[] = [
  { method: "GET", path: "/health", auth: "none", handler: healthHandler },
  {
    method: "GET",
    path: "/pricing",
    auth: "none",
    handler: storePricingHandler,
  },
  { method: "POST", path: "/webhook", auth: "none", handler: webhookHandler },

  { method: "POST", path: "/auth/otp", auth: "none", handler: otpHandler },
  {
    method: "POST",
    path: "/billing/checkout",
    auth: "jwt",
    handler: checkoutHandler,
  },
  {
    method: "POST",
    path: "/billing/verify-transaction",
    auth: "jwt",
    handler: verifyTransactionHandler,
  },
  {
    method: "GET",
    path: "/billing/flags",
    auth: "none",
    handler: billingFlagsHandler,
  },
  {
    method: "GET",
    path: "/transcribe/stream",
    auth: "jwt-subprotocol",
    handler: streamHandler,
  },
  { method: "GET", path: "/usage", auth: "jwt", handler: usageHandler },
  {
    method: "POST",
    path: "/transcribe",
    auth: "jwt",
    preflight: "transcribe",
    handler: transcribeHandler,
  },
  {
    method: "POST",
    path: "/translate",
    auth: "jwt",
    preflight: "translate",
    handler: translateHandler,
  },
  {
    method: "POST",
    path: "/synthesize",
    auth: "jwt",
    handler: synthesizeHandler,
  },
  {
    method: "POST",
    path: "/devices/token",
    auth: "optional-jwt",
    handler: registerDeviceTokenHandler,
  },
  {
    method: "GET",
    path: "/update/manifest",
    auth: "none",
    handler: getUpdateManifestHandler,
  },
  {
    method: "POST",
    path: "/admin/update/notify",
    auth: "admin",
    handler: updateNotifyHandler,
  },
  {
    method: "POST",
    path: "/admin/update/manifest",
    auth: "admin",
    handler: postUpdateManifestHandler,
  },
];

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
