import type { ExecutionContext } from "@cloudflare/workers-types";

import { authenticate } from "./auth";
import { handleCheckoutInitialize } from "./checkout";
import { logger } from "./logger";
import { guardContentType, guardJsonSize } from "./security";
import { handleTranscribe, handleStream } from "./transcribe";
import { handleTranslate } from "./translate";
import { Env, Tier } from "./types";
import { checkPreflight, postflightDeduction } from "./utils";
import { handleWebhook } from "./webhook";

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || request.headers.get("origin");
  const allowedOrigins =
    env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [];

  const isProduction = env.APP_ENV === "production";
  const isDevOrigin =
    !!origin &&
    (origin.startsWith("exp://") ||
      origin.includes(".expo.dev") ||
      origin.includes(".expo.io") ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1"));
  const isAllowed =
    !!origin &&
    (allowedOrigins.includes(origin) || (!isProduction && isDevOrigin));

  return {
    ...(isAllowed && { "Access-Control-Allow-Origin": origin }),
    ...(isAllowed && { "Access-Control-Allow-Credentials": "true" }),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      return await this.handleRequest(request, env, ctx);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error("[global] Unhandled exception", { error: errorMsg });
      const corsHeaders = getCorsHeaders(request, env);
      return this.addCorsHeaders(
        Response.json(
          { error: "EKWE_NETWORK_LOST", message: errorMsg },
          { status: 500 },
        ),
        corsHeaders,
      );
    }
  },

  async handleRequest(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let response: Response;

    // ─── Webhook Route (no JWT auth — uses signature verification) ───
    if (request.method === "POST" && url.pathname === "/webhook") {
      response = await handleWebhook(request, env);
      return this.addCorsHeaders(response, corsHeaders);
    }

    // ─── Auth: Strict JWT Only ───
    const isStream = url.pathname === '/transcribe/stream';
    const token = isStream
      ? url.searchParams.get('token')
      : request.headers.get('Authorization')?.startsWith('Bearer ')
        ? request.headers.get('Authorization')!.slice(7)
        : null;

    let userId = '';
    let userEmail = '';
    let tier: Tier = 'FREE';

    if (token) {
      const auth = await authenticate(token, env);
      if (!auth) {
        const body = isStream
          ? new Response('Invalid token', { status: 401 })
          : this.addCorsHeaders(
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
        : this.addCorsHeaders(
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
    // Protects against API spam on a per-user basis, with IP-level fallback
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get("CF-Connecting-IP") || "";
      const rateLimitKey = clientIp ? `${userId}::${clientIp}` : userId;

      const { success } = await env.RATE_LIMITER.limit({ key: rateLimitKey });
      if (!success) {
        logger.warn(`[rate-limiter] Blocked request for key: ${rateLimitKey}`);
        return this.addCorsHeaders(
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

    // ─── KV-BASED PER-USER RATE LIMITING (EDGE LAYER) ───
    // Fast per-user protection using Cloudflare KV - 50 requests/minute per user
    const kvRateLimitKey = `ratelimit:user:${userId}`;
    const currentCount = await env.EKWE_KV.get(kvRateLimitKey);
    const requestCount = parseInt(currentCount || "0", 10);

    if (requestCount >= 50) {
      logger.warn(`[kv-ratelimit] User ${userId} exceeded 50 req/min`);
      return this.addCorsHeaders(
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

    // Increment counter with 60-second TTL
    await env.EKWE_KV.put(kvRateLimitKey, String(requestCount + 1), {
      expirationTtl: 60,
    });

    // ─── 1. PRE-FLIGHT CHECK (ATOMIC COOLDOWN) ───
    const preflight = await checkPreflight(env, userId, tier);
    if (!preflight.allowed) {
      return this.addCorsHeaders(
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

    // ─── 2. EXECUTION ───
    try {
      if (request.method === "POST" && url.pathname === "/transcribe") {
        const ctGuard = guardContentType(request, "multipart");
        if (!ctGuard.allowed)
          return this.addCorsHeaders(ctGuard.response, corsHeaders);
        response = await handleTranscribe(
          request,
          env,
          preflight.tier_active,
          request.signal,
        );
      } else if (request.method === "POST" && url.pathname === "/translate") {
        const ctGuard = guardContentType(request, "json");
        if (!ctGuard.allowed)
          return this.addCorsHeaders(ctGuard.response, corsHeaders);
        const sizeGuard = guardJsonSize(request, 128_000);
        if (!sizeGuard.allowed)
          return this.addCorsHeaders(sizeGuard.response, corsHeaders);
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
          return this.addCorsHeaders(ctGuard.response, corsHeaders);
        const sizeGuard = guardJsonSize(request, 128_000);
        if (!sizeGuard.allowed)
          return this.addCorsHeaders(sizeGuard.response, corsHeaders);
        response = await handleCheckoutInitialize(
          request,
          env,
          userId,
          userEmail,
        );
        return this.addCorsHeaders(response, corsHeaders);
      } else {
        response = Response.json({ error: "NOT_FOUND" }, { status: 404 });
      }

      // ─── 3. POST-FLIGHT DEDUCTION ───
      if (response.ok) {
        // Read the response body first
        const resBody = (await response.clone().json()) as Record<
          string,
          unknown
        >;

        // 1 Half Transaction = 1 Credit
        const cost = 1;

        // Deduct inline (blocking) to guarantee billing accuracy.
        // ctx.waitUntil is NOT used because the deduction must complete before
        // the response is sent — otherwise rapid requests race past the cooldown.
        const deductionResult = await postflightDeduction(env, userId, cost);

        if (!deductionResult) {
          logger.error(
            "[postflight] deduction failed — billing bypass prevented",
          );
          return this.addCorsHeaders(
            Response.json(
              {
                error: "BILLING_FAILED",
                message:
                  "Transaction could not be processed. Please try again.",
              },
              { status: 502 },
            ),
            corsHeaders,
          );
        }

        response = Response.json(
          { ...resBody, transaction: deductionResult },
          { status: response.status },
        );
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg === "CLIENT_ABORTED") {
        return new Response(null, { status: 499 });
      }
      response = Response.json(
        { error: "EKWE_NETWORK_LOST", message: errorMsg },
        { status: 500 },
      );
    }

    return this.addCorsHeaders(response, corsHeaders);
  },

  addCorsHeaders(
    response: Response,
    corsHeaders: Record<string, string>,
  ): Response {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};
