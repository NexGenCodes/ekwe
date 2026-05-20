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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    let response: Response;

    // ─── Webhook Route (no JWT auth — uses signature verification) ───
    if (request.method === 'POST' && url.pathname === '/webhook') {
      response = await handleWebhook(request, env);
      return this.addCorsHeaders(response, CORS_HEADERS);
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
        return this.addCorsHeaders(Response.json({ error: 'INVALID_TOKEN' }, { status: 401 }), CORS_HEADERS);
      }
    } else {
      // No valid JWT provided — block completely
      return this.addCorsHeaders(Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }), CORS_HEADERS);
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
          CORS_HEADERS
        );
      }
    }

    // ─── 1. PRE-FLIGHT CHECK (ATOMIC COOLDOWN) ───
    const preflight = await checkPreflight(env, userId, tier);
    if (!preflight.allowed) {
      return this.addCorsHeaders(
        Response.json({ error: 'EKWE_RATE_LIMIT', message: `Please wait ${Math.ceil(preflight.cooldown_remaining || 0)} seconds.` }, { status: 429 }),
        CORS_HEADERS
      );
    }

    // ─── 2. EXECUTION ───
    try {
      if (request.method === 'POST' && url.pathname === '/transcribe') {
        const ctGuard = guardContentType(request, 'multipart');
        if (!ctGuard.allowed) return this.addCorsHeaders(ctGuard.response, CORS_HEADERS);
        response = await handleTranscribe(request, env, preflight.tier_active, request.signal);
      } else if (request.method === 'POST' && url.pathname === '/translate') {
        const ctGuard = guardContentType(request, 'json');
        if (!ctGuard.allowed) return this.addCorsHeaders(ctGuard.response, CORS_HEADERS);
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

    return this.addCorsHeaders(response, CORS_HEADERS);
  },

  addCorsHeaders(response: Response, CORS_HEADERS: Record<string, string>): Response {
    const newHeaders = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};
