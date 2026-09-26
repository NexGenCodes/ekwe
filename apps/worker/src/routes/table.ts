/**
 * The HTTP route table and the handlers that back it.
 *
 * Kept out of `worker.ts` so that file is only the Worker entrypoint (fetch,
 * scheduled, queue). Tests import `routes` from here to exercise the same
 * table production uses, rather than rebuilding one — a hand-rolled table is
 * how the `Server-Timing` wiring bug stayed invisible.
 */
import {
  guardAutoDetect,
  guardLanguageCode,
  guardStreamingAllowed,
  guardWebSocketUpgrade,
} from "@/core/guards";
import {
  type AppRoute,
  type AuthedRouteHandler,
  type OptionalAuthedRouteHandler,
  type RouteHandler,
} from "@/core/pipeline";
import { isProviderDegraded } from "@/services/health";
import { PROVIDER_MODULES } from "@/providers";
import { handleTranscribe } from "@/routes/transcribe";
import { handleTranslate } from "@/routes/translate";
import { handleSynthesize } from "@/routes/synthesize";
import { speechAudioHandler } from "@/routes/speech-audio";
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
    // Without this the handler writes its stage timings into a throwaway
    // default RequestTimings and the pipeline's Server-Timing header only ever
    // shows auth/rate, hiding exactly the stages this instrumentation exists to
    // measure.
    rctx.timings,
  );

const registerDeviceTokenHandler: OptionalAuthedRouteHandler = (rctx) =>
  handleRegisterDeviceToken(rctx.request, rctx.env, rctx.auth);

const updateNotifyHandler: RouteHandler = (rctx) =>
  handleUpdateNotify(rctx.request, rctx.env);

const getUpdateManifestHandler: RouteHandler = (rctx) =>
  handleGetUpdateManifest(rctx.request, rctx.env, rctx.ctx);

const postUpdateManifestHandler: RouteHandler = (rctx) =>
  handlePostUpdateManifest(rctx.request, rctx.env);

export const routes: AppRoute[] = [
  { method: "GET", path: "/health", auth: "none", handler: healthHandler },
  {
    method: "GET",
    path: "/speech/:key",
    auth: "none",
    handler: speechAudioHandler,
  },
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
