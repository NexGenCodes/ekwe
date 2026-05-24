import { Env, Tier, JWTPayloadWithMeta } from './types';
import { handleTranscribe } from './transcribe';
import { handleTranslate } from './translate';
import { checkPreflight, postflightDeduction } from './utils';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { logger } from './logger';
import { guardContentType } from './security';
import { handleWebhook } from './webhook';

let JWKS: ReturnType<typeof createRemoteJWKSet>;

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || request.headers.get('origin');
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    origin.startsWith('exp://') ||
    origin.includes('.expo.dev') ||
    origin.includes('.expo.io') ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1')
  );

  return {
    ...(isAllowed && { 'Access-Control-Allow-Origin': origin }),
    ...(isAllowed && { 'Access-Control-Allow-Credentials': 'true' }),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let response: Response;

    // ─── Webhook Route (no JWT auth — uses signature verification) ───
    if (request.method === 'POST' && url.pathname === '/webhook') {
      response = await handleWebhook(request, env);
      return this.addCorsHeaders(response, corsHeaders);
    }

    // ─── Auth: Strict JWT Only ───
    let tier: Tier = 'FREE';
    let userId = '';

    const authHeader = request.headers.get('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        if (!JWKS) {
          JWKS = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
        }
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: `${env.SUPABASE_URL}/auth/v1`,
          audience: 'authenticated'
        });
        const meta = payload as JWTPayloadWithMeta;
        userId = meta.sub || '';
        
        if (!userId) throw new Error('Missing sub in JWT');

        if (meta.app_metadata?.is_pro) {
          tier = 'PREMIUM';
        }
      } catch (err) {
        return this.addCorsHeaders(Response.json({ error: 'INVALID_TOKEN' }, { status: 401 }), corsHeaders);
      }
    } else {
      // No valid JWT provided — block completely
      return this.addCorsHeaders(Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }), corsHeaders);
    }

    // ─── SECURITY GATING: Cloudflare Rate Limiting ───
    // Protects against API spam on a per-user basis, with IP-level fallback
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get('CF-Connecting-IP') || '';
      const rateLimitKey = clientIp ? `${userId}::${clientIp}` : userId;

      const { success } = await env.RATE_LIMITER.limit({ key: rateLimitKey });
      if (!success) {
        logger.warn(`[rate-limiter] Blocked request for key: ${rateLimitKey}`);
        return this.addCorsHeaders(
          Response.json({ error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Please slow down.' }, { status: 429 }),
          corsHeaders
        );
      }
    }

    // ─── KV-BASED PER-USER RATE LIMITING (EDGE LAYER) ───
    // Fast per-user protection using Cloudflare KV - 50 requests/minute per user
    const kvRateLimitKey = `ratelimit:user:${userId}`;
    const currentCount = await env.EKWE_KV.get(kvRateLimitKey);
    const requestCount = parseInt(currentCount || '0', 10);
    
    if (requestCount >= 50) {
      logger.warn(`[kv-ratelimit] User ${userId} exceeded 50 req/min`);
      return this.addCorsHeaders(
        Response.json({ error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded. Please slow down.' }, { status: 429 }),
        corsHeaders
      );
    }
    
    // Increment counter with 60-second TTL
    await env.EKWE_KV.put(kvRateLimitKey, String(requestCount + 1), { expirationTtl: 60 });

    // ─── 1. PRE-FLIGHT CHECK (ATOMIC COOLDOWN) ───
    const preflight = await checkPreflight(env, userId, tier);
    if (!preflight.allowed) {
      return this.addCorsHeaders(
        Response.json({ error: 'EKWE_RATE_LIMIT', message: `Please wait ${Math.ceil(preflight.cooldown_remaining || 0)} seconds.` }, { status: 429 }),
        corsHeaders
      );
    }

    // ─── 2. EXECUTION ───
    try {
      if (request.method === 'POST' && url.pathname === '/transcribe') {
        const ctGuard = guardContentType(request, 'multipart');
        if (!ctGuard.allowed) return this.addCorsHeaders(ctGuard.response, corsHeaders);
        response = await handleTranscribe(request, env, preflight.tier_active, request.signal);
      } else if (request.method === 'POST' && url.pathname === '/translate') {
        const ctGuard = guardContentType(request, 'json');
        if (!ctGuard.allowed) return this.addCorsHeaders(ctGuard.response, corsHeaders);
        response = await handleTranslate(request, env, preflight.tier_active, request.signal);
      } else {
        response = Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      // ─── 3. POST-FLIGHT DEDUCTION ───
      if (response.ok) {
        // Read the response body first
        const resBody = await response.clone().json() as Record<string, unknown>;

        // 1 Half Transaction = 1 Credit
        const cost = 1;

        // Deduct inline (blocking) to guarantee billing accuracy.
        // ctx.waitUntil is NOT used because the deduction must complete before
        // the response is sent — otherwise rapid requests race past the cooldown.
        const deductionResult = await postflightDeduction(env, userId, cost);

        if (!deductionResult) {
          logger.error('[postflight] deduction failed — billing bypass prevented');
          return this.addCorsHeaders(
            Response.json({ error: 'BILLING_FAILED', message: 'Transaction could not be processed. Please try again.' }, { status: 502 }),
            corsHeaders
          );
        }

        response = Response.json({ ...resBody, transaction: deductionResult }, { status: response.status });
      }

    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg === 'CLIENT_ABORTED') {
        return new Response(null, { status: 499 });
      }
      response = Response.json(
        { error: 'EKWE_NETWORK_LOST', message: errorMsg },
        { status: 500 },
      );
    }

    return this.addCorsHeaders(response, corsHeaders);
  },

  addCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};
