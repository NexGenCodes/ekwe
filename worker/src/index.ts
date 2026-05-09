import { Env, Tier, JWTPayloadWithMeta } from './types';
import { handleTranscribe } from './transcribe';
import { handleTranslate } from './translate';
import { checkPreflight, postflightDeduction, getEvasionHeaders } from './utils';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { ExecutionContext } from '@cloudflare/workers-types';

let JWKS: ReturnType<typeof createRemoteJWKSet>;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ─── IP Evasion & Anti-Ban Setup ───
    (env as any).EVASION_HEADERS = getEvasionHeaders(request);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let response: Response;

    // Auth verification
    let tier: Tier = 'FREE';
    let userId = 'anonymous';

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return this.addCorsHeaders(Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }), corsHeaders);
    }

    try {
      const token = authHeader.split(' ')[1];
      if (!JWKS) {
        JWKS = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
      }
      const { payload } = await jwtVerify(token, JWKS);
      const meta = payload as JWTPayloadWithMeta;
      userId = meta.sub || 'anonymous';
      if (meta.app_metadata?.is_pro) {
        tier = 'PREMIUM';
      }
    } catch (err) {
      return this.addCorsHeaders(Response.json({ error: 'INVALID_TOKEN' }, { status: 401 }), corsHeaders);
    }

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
        response = await handleTranscribe(request, env, preflight.tier_active, request.signal);
      } else if (request.method === 'POST' && url.pathname === '/translate') {
        response = await handleTranslate(request, env, preflight.tier_active, request.signal);
      } else {
        response = Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      // ─── 3. POST-FLIGHT DEDUCTION ───
      if (response.ok) {
        // Clone the response so we can read the JSON body
        const resBody = await response.clone().json() as Record<string, unknown>;
        
        // 1 Half Transaction = 1 Credit
        const cost = 1; 
        
        // Deduct in the background using ctx.waitUntil to prevent blocking the user response
        ctx.waitUntil(postflightDeduction(env, userId, cost));

        // Inject transaction metadata
        resBody.transaction = {
          cost,
          transactions_used: preflight.transactions_used + cost,
          tier_active: preflight.tier_active,
          is_fallback: preflight.is_fallback
        };

        response = Response.json(resBody, { status: response.status });
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
