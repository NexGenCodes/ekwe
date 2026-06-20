import { authenticate } from "./auth";
import { getCorsHeaders, addCorsHeaders } from "./cors";
import { logger, setDebugEnabled } from "./logger";
import { guardContentType, guardJsonSize } from "./security";
import { handleTranscribe } from "./routes/transcribe";
import { handleStream } from "./routes/stream";
import { handleTranslate } from "./routes/translate";
import { handleCheckoutInitialize, handlePricing } from "./routes/checkout";

import { handleWebhook } from "./routes/webhook";
import { CLIENT_ABORTED, Env, Tier } from "./types";
import { checkPreflight } from "./utils/preflight";

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  setDebugEnabled(env.APP_ENV !== 'production');
  const corsHeaders = getCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  let response: Response;

  // ─── Webhook Route (no JWT auth — uses signature verification) ───
  if (request.method === "POST" && url.pathname === "/webhook") {
    response = await handleWebhook(request, env);
    return addCorsHeaders(response, corsHeaders);
  }

  // ─── Auth: Strict JWT Only ───
  const isStream = url.pathname === '/transcribe/stream';
  const token = isStream
    ? url.searchParams.get('token')
    : request.headers.get('Authorization')?.startsWith('Bearer ')
      ? request.headers.get('Authorization')!.slice(7)
      : null;

  let userId: string;
  let userEmail: string;
  let tier: Tier;

  if (token) {
    const auth = await authenticate(token, env);
    if (!auth) {
      const body = isStream
        ? new Response('Invalid token', { status: 401 })
        : addCorsHeaders(
            Response.json({ error: 'INVALID_TOKEN' }, { status: 401 }),
            corsHeaders,
          );
      return body;
    }
    userId = auth.userId;
    userEmail = auth.userEmail;
    tier = auth.tier;
  } else {
    const body = isStream
      ? new Response('Missing token', { status: 401 })
      : addCorsHeaders(
          Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
          corsHeaders,
        );
    return body;
  }

  // ─── Streaming WebSocket Route (after auth, before rate limits) ───
  if (isStream) {
    return handleStream(request, env, userId, tier);
  }

  // ─── SECURITY GATING: Cloudflare Rate Limiting ───
  if (env.RATE_LIMITER) {
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    const rateLimitKey = clientIp ? `${userId}::${clientIp}` : userId;

    const { success } = await env.RATE_LIMITER.limit({ key: rateLimitKey });
    if (!success) {
      logger.warn(`[rate-limiter] Blocked request for key: ${rateLimitKey}`);
      return addCorsHeaders(
        Response.json(
          {
            error: "TOO_MANY_REQUESTS",
            message: "Rate limit exceeded. Please slow down.",
          },
          { status: 429 },
        ),
        corsHeaders,
      );
    }
  }

  // ─── 1. PRE-FLIGHT CHECK (ATOMIC COOLDOWN + CACHED) ───
  let preflight: Awaited<ReturnType<typeof checkPreflight>>;
  const cacheKey = `preflight:${userId}`;
  const cached = await env.EKWE_KV.get(cacheKey);
  if (cached) {
    try {
      preflight = JSON.parse(cached);
    } catch {
      logger.debug('[index] Cache parse failed, fetching fresh preflight');
      preflight = await checkPreflight(env, userId, tier);
    }
  } else {
    preflight = await checkPreflight(env, userId, tier);
  }

  if (!preflight.allowed) {
    return addCorsHeaders(
      Response.json(
        {
          error: "EKWE_RATE_LIMIT",
          message: `Please wait ${Math.ceil(preflight.cooldown_remaining || 0)} seconds.`,
        },
        { status: 429 },
      ),
      corsHeaders,
    );
  }

  if (!cached) {
    ctx.waitUntil(
      env.EKWE_KV.put(cacheKey, JSON.stringify(preflight), {
        expirationTtl: 2,
      }).catch(() => {}),
    );
  }

  // ─── 2. EXECUTION ───
  try {
    if (request.method === "POST" && url.pathname === "/transcribe") {
      const ctGuard = guardContentType(request, "multipart");
      if (!ctGuard.allowed)
        return addCorsHeaders(ctGuard.response, corsHeaders);
      response = await handleTranscribe(
        request,
        env,
        preflight.tier_active,
        request.signal,
      );
    } else if (request.method === "GET" && url.pathname === "/checkout/pricing") {
      response = await handlePricing(env);
      return addCorsHeaders(response, corsHeaders);
    } else if (request.method === "POST" && url.pathname === "/translate") {
      const ctGuard = guardContentType(request, "json");
      if (!ctGuard.allowed)
        return addCorsHeaders(ctGuard.response, corsHeaders);
      const sizeGuard = guardJsonSize(request, 128_000);
      if (!sizeGuard.allowed)
        return addCorsHeaders(sizeGuard.response, corsHeaders);
      response = await handleTranslate(
        request,
        env,
        preflight.tier_active,
        request.signal,
      );
    } else if (
      request.method === "POST" &&
      url.pathname === "/checkout/initialize"
    ) {
      const ctGuard = guardContentType(request, "json");
      if (!ctGuard.allowed)
        return addCorsHeaders(ctGuard.response, corsHeaders);
      const sizeGuard = guardJsonSize(request, 128_000);
      if (!sizeGuard.allowed)
        return addCorsHeaders(sizeGuard.response, corsHeaders);
      response = await handleCheckoutInitialize(
        request,
        env,
        userId,
        userEmail,
      );
      return addCorsHeaders(response, corsHeaders);
    } else {
      response = Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }

  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (errorMsg === CLIENT_ABORTED) {
      return new Response(null, { status: 499 });
    }
    logger.error("[handleRequest] Execution error", { error: errorMsg });
    response = Response.json(
      { error: "EKWE_SERVER_ERROR", message: "An unexpected error occurred." },
      { status: 500 },
    );
  }

  return addCorsHeaders(response, corsHeaders);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error("[global] Unhandled exception", { error: errorMsg });
      const corsHeaders = getCorsHeaders(request, env);
      return addCorsHeaders(
        Response.json(
          { error: "EKWE_SERVER_ERROR", message: "An unexpected error occurred." },
          { status: 500 },
        ),
        corsHeaders,
      );
    }
  },
} satisfies ExportedHandler<Env>;
