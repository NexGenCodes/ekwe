import { authenticate } from "./auth";
import { getCorsHeaders, addCorsHeaders } from "./cors";
import { logger, setDebugEnabled } from "./logger";
import {
  guardContentType,
  guardJsonSize,
  guardAutoDetect,
  guardLanguageCode,
  guardStreamingAllowed,
} from "./security";
import { handleTranscribe } from "./routes/transcribe";
import { handleTranslate } from "./routes/translate";
import { handleCheckoutInitialize, handlePricing } from "./routes/checkout";

import { handleWebhook } from "./routes/webhook";
import { CLIENT_ABORTED, Env, Tier } from "./types";
import { checkPreflight } from "./utils/preflight";

export { StreamDurableObject } from "./stream-do";

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  setDebugEnabled(env.APP_ENV !== "production");
  const corsHeaders = getCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  let response: Response;

  // ─── Health Check (no auth required) ───
  if (request.method === "GET" && url.pathname === "/health") {
    return addCorsHeaders(
      Response.json({ status: "ok", timestamp: Date.now() }),
      corsHeaders,
    );
  }

  // ─── Webhook Route (no JWT auth — uses signature verification) ───
  if (request.method === "POST" && url.pathname === "/webhook") {
    response = await handleWebhook(request, env, ctx);
    return addCorsHeaders(response, corsHeaders);
  }

  // ─── Auth: Strict JWT Only ───
  const isStream = url.pathname === "/transcribe/stream";
  let token: string | null;
  if (isStream) {
    // WebSocket credentials ride in Sec-WebSocket-Protocol, NOT the query
    // string, so the JWT never lands in access logs, referrers, or proxies.
    const protocols = request.headers.get("Sec-WebSocket-Protocol");
    token = protocols ? protocols.split(",")[0].trim() : null;
  } else {
    token = request.headers.get("Authorization")?.startsWith("Bearer ")
      ? request.headers.get("Authorization")!.slice(7)
      : null;
  }

  let userId: string;
  let userEmail: string;
  let tier: Tier;

  if (token) {
    const auth = await authenticate(token, env);
    if (!auth) {
      const body = isStream
        ? new Response("Invalid token", { status: 401 })
        : addCorsHeaders(
            Response.json({ error: "INVALID_TOKEN" }, { status: 401 }),
            corsHeaders,
          );
      return body;
    }
    userId = auth.userId;
    userEmail = auth.userEmail;
    tier = auth.tier;
  } else {
    const body = isStream
      ? new Response("Missing token", { status: 401 })
      : addCorsHeaders(
          Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
          corsHeaders,
        );
    return body;
  }

  // ─── SECURITY GATING: Cloudflare Rate Limiting ───
  if (env.RATE_LIMITER) {
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    const rateLimitKey = clientIp ? `${userId}::${clientIp}` : userId;

    const { success } = await env.RATE_LIMITER.limit({ key: rateLimitKey });
    if (!success) {
      logger.warn(`[rate-limiter] Blocked request for key: ${rateLimitKey}`);
      if (isStream) {
        return new Response("Rate limit exceeded", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      return addCorsHeaders(
        Response.json(
          {
            error: "TOO_MANY_REQUESTS",
            message: "Rate limit exceeded. Please slow down.",
          },
          { status: 429, headers: { "Retry-After": "60" } },
        ),
        corsHeaders,
      );
    }
  }

  // ─── Streaming WebSocket Route (after auth + rate limits) ───
  if (isStream) {
    // Validate in the Worker first to avoid DO billing for invalid requests.
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

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
    const stub = env.STREAM_DO.getByName(userId);
    return stub.fetch(new Request(doUrl.toString(), request));
  }

  // ─── PRE-FLIGHT CHECK (ATOMIC COOLDOWN + CACHED) ───
  let preflight: Awaited<ReturnType<typeof checkPreflight>>;
  const cacheKey = `preflight:${userId}`;
  const cached = await env.EKWE_KV.get(cacheKey);
  if (cached) {
    try {
      preflight = JSON.parse(cached) as Awaited<
        ReturnType<typeof checkPreflight>
      >;
    } catch {
      logger.debug("[index] Cache parse failed, fetching fresh preflight");
      preflight = await checkPreflight(env, userId, tier);
    }
  } else {
    preflight = await checkPreflight(env, userId, tier);
  }

  if (!preflight.allowed) {
    const retryAfter = Math.ceil(preflight.cooldown_remaining || 0);
    return addCorsHeaders(
      Response.json(
        {
          error: "EKWE_RATE_LIMIT",
          message: `Please wait ${retryAfter} seconds.`,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
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
        userId,
      );
    } else if (
      request.method === "GET" &&
      url.pathname === "/checkout/pricing"
    ) {
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
        userId,
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
          {
            error: "EKWE_SERVER_ERROR",
            message: "An unexpected error occurred.",
          },
          { status: 500 },
        ),
        corsHeaders,
      );
    }
  },

  // Daily maintenance (see wrangler.toml [triggers] crons): purge expired
  // history rows per plan retention (free: 30d, pro: 365d).
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;

async function runMaintenance(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error("[scheduled] Missing Supabase credentials");
    return;
  }

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/cleanup_expired_history`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );

    if (!res.ok) {
      const body = await res.text();
      logger.error("[scheduled] cleanup_expired_history failed", {
        status: res.status,
        body: body.slice(0, 500),
      });
      return;
    }

    const result = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    logger.info("[scheduled] cleanup_expired_history completed", result);
  } catch (err) {
    logger.error("[scheduled] Maintenance run failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
