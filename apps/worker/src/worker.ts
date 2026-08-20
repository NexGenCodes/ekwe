import { WORKER_ERROR_CODES } from "@ekwe/shared";
import {
  guardAutoDetect,
  guardContentType,
  guardJsonSize,
  guardLanguageCode,
  guardStreamingAllowed,
  guardWebSocketUpgrade,
  MAX_JSON_BODY_BYTES,
} from "./core/guards";
import {
  runPipeline,
  type AppRoute,
  type AuthedRouteHandler,
  type RouteHandler,
} from "./core/pipeline";
import { addCorsHeaders, getCorsHeaders } from "./core/cors";
import { error } from "./core/http";
import { logger } from "./core/logger";
import type { Env } from "./core/types";
import { d1Cleanup } from "./services/d1-cache";
import { supabasePost } from "./services/supabase";
import { handleTranscribe } from "./routes/transcribe";
import { handleTranslate } from "./routes/translate";
import { handleTts } from "./routes/tts";
import { handleStorePricing } from "./routes/pricing";
import { handleUsage } from "./routes/usage";
import { handleWebhook } from "./routes/webhook";
import { handleFlutterwaveWebhook } from "./routes/flutterwave";
import { handleCheckout, handleBillingFlags } from "./routes/billing";
import { handleSendOtp } from "./routes/otp";
import { handleRegisterPushToken } from "./routes/push-tokens";
import { handlePushNotify } from "./routes/push-notify";
import {
  handleGetUpdateManifest,
  handlePostUpdateManifest,
} from "./routes/update-manifest";

// ─── Route table ─────────────────────────────────────────────────
// Single source of truth for every endpoint the worker serves. Each route
// declares its auth mode and — for the billable routes — which daily usage
// pool the preflight gate draws down. `auth: "jwt-subprotocol"` reads the
// token from Sec-WebSocket-Protocol so it never lands in access logs.

const healthHandler: RouteHandler = () =>
  Response.json({ status: "ok", timestamp: Date.now() });

const storePricingHandler: RouteHandler = (rctx) =>
  handleStorePricing(rctx.request, rctx.env, rctx.ctx);

const webhookHandler: RouteHandler = (rctx) =>
  handleWebhook(rctx.request, rctx.env, rctx.ctx);

const flutterwaveWebhookHandler: RouteHandler = (rctx) =>
  handleFlutterwaveWebhook(rctx.request, rctx.env, rctx.ctx);

const checkoutHandler: AuthedRouteHandler = (rctx) =>
  handleCheckout(rctx.request, rctx.env, rctx.auth);

const billingFlagsHandler: RouteHandler = (rctx) =>
  handleBillingFlags(rctx.request, rctx.env);

const otpHandler: RouteHandler = (rctx) => {
  const ctGuard = guardContentType(rctx.request);
  if (!ctGuard.allowed) return ctGuard.response;
  return handleSendOtp(rctx.request, rctx.env);
};

const streamHandler: AuthedRouteHandler = (rctx) => {
  const { request, env } = rctx;
  const { userId, tier } = rctx.auth;

  // Validate in the Worker first to avoid DO billing for invalid requests.
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

  // One DO per user: persistent, hibernating, per-user concurrency cap.
  const doUrl = new URL(request.url);
  doUrl.searchParams.set("tier", tier);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- wrangler-generated DurableObjectNamespace<import()> is unresolvable by ESLint
  const stub = env.STREAM_DO.getByName(userId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- stub is untyped due to import() in wrangler types
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

const translateHandler: AuthedRouteHandler = (rctx) => {
  const ctGuard = guardContentType(rctx.request);
  if (!ctGuard.allowed) return ctGuard.response;
  const sizeGuard = guardJsonSize(rctx.request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;
  return handleTranslate(
    rctx.request,
    rctx.env,
    rctx.auth.tier,
    rctx.request.signal,
    rctx.auth.userId,
    rctx.ctx,
  );
};

const ttsHandler: AuthedRouteHandler = (rctx) => {
  const ctGuard = guardContentType(rctx.request);
  if (!ctGuard.allowed) return ctGuard.response;
  const sizeGuard = guardJsonSize(rctx.request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;
  return handleTts(rctx.request, rctx.env, rctx.auth.tier, rctx.request.signal);
};

const registerPushTokenHandler: RouteHandler = (rctx) =>
  handleRegisterPushToken(rctx.request, rctx.env);

const pushNotifyHandler: RouteHandler = (rctx) =>
  handlePushNotify(rctx.request, rctx.env);

const getUpdateManifestHandler: RouteHandler = (rctx) =>
  handleGetUpdateManifest(rctx.request, rctx.env, rctx.ctx);

const postUpdateManifestHandler: RouteHandler = (rctx) =>
  handlePostUpdateManifest(rctx.request, rctx.env);

const routes: AppRoute[] = [
  { method: "GET", path: "/health", auth: "none", handler: healthHandler },
  { method: "GET", path: "/pricing", auth: "none", handler: storePricingHandler },
  { method: "POST", path: "/webhook", auth: "none", handler: webhookHandler },
  {
    method: "POST",
    path: "/webhook/flutterwave",
    auth: "none",
    handler: flutterwaveWebhookHandler,
  },
  { method: "POST", path: "/auth/otp", auth: "none", handler: otpHandler },
  {
    method: "POST",
    path: "/billing/checkout",
    auth: "jwt",
    handler: checkoutHandler,
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
    path: "/tts",
    auth: "jwt",
    handler: ttsHandler,
  },
  {
    method: "POST",
    path: "/push-tokens",
    auth: "none",
    handler: registerPushTokenHandler,
  },
  {
    method: "POST",
    path: "/push-notify",
    auth: "none",
    handler: pushNotifyHandler,
  },
  {
    method: "GET",
    path: "/update/manifest",
    auth: "none",
    handler: getUpdateManifestHandler,
  },
  {
    method: "POST",
    path: "/update/manifest",
    auth: "none",
    handler: postUpdateManifestHandler,
  },
];

// ─── Maintenance (cron) ──────────────────────────────────────────
// Daily maintenance (see wrangler.jsonc triggers.crons): purge expired
// history rows per plan retention (free: 30d, pro: 365d).

async function runMaintenance(env: Env): Promise<void> {
  // D1 cache cleanup — best-effort, non-blocking
  if (env.EKWE_D1) {
    try {
      await d1Cleanup(env.EKWE_D1, "cache_translation");
      await d1Cleanup(env.EKWE_D1, "cache_transcription");
      await d1Cleanup(env.EKWE_D1, "cache_lang");
      logger.info("[scheduled] D1 cache cleanup completed");
    } catch (err) {
      logger.error("[scheduled] D1 cache cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Enqueue Supabase RPC — queue consumer handles retries (max 3) and DLQ.
  try {
    await env.MAINTENANCE_QUEUE.send({ type: "cleanup_expired_history" });
    logger.info("[scheduled] Enqueued cleanup_expired_history");
  } catch (err) {
    logger.error("[scheduled] Failed to enqueue maintenance task", {
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
            // Throw to trigger retry (up to 3 attempts before DLQ)
            throw new Error(`cleanup_expired_history failed: ${res.status}`);
          }

          const result = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          logger.info("[queue] cleanup_expired_history completed", result);
        }
      }
    },
  } satisfies ExportedHandler<Env>;
}