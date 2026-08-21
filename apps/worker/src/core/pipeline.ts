import { WORKER_ERROR_CODES, type UsageType } from "@ekwe/shared";
import { authenticate, type AuthResult } from "./auth";
import { addCorsHeaders, getCorsHeaders } from "./cors";
import { HttpError, error } from "./http";
import { logger, setDebugEnabled } from "./logger";
import { tooManyRequests } from "./guards";
import { matchRoute, type RouteLike } from "./router";
import { runPreflightGate } from "../services/preflight";
import { CLIENT_ABORTED, type Env } from "./types";

/**
 * ─── Request pipeline ───────────────────────────────────────────
 *
 * Linear request lifecycle shared by every route:
 *
 *   1. CORS headers (OPTIONS shortcut)
 *   2. Route match → 404 before auth/RPC so garbage paths can neither
 *      probe for routes nor trigger paid backend calls
 *   3. Public routes pass straight through (signature/Turnstile checks
 *      happen in-handler)
 *   4. JWT auth (header, or Sec-WebSocket-Protocol for streams)
 *   5. Cloudflare Rate Limiter (user+IP keyed)
 *   6. Streaming route → handler directly (101 cannot be CORS-wrapped)
 *   7. Preflight gate for billable routes (atomic cooldown + quota,
 *      DB-backed tier override)
 *   8. Execution with uniform error handling
 */

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
}

export type RouteHandler = (rctx: RouteContext) => Response | Promise<Response>;

export type AuthedRouteHandler = (
  rctx: RouteContext & { auth: AuthResult },
) => Response | Promise<Response>;

interface PublicRoute extends RouteLike {
  auth: "none";
  handler: RouteHandler;
}

interface ProtectedRoute extends RouteLike {
  auth: "jwt" | "jwt-subprotocol";
  /** Daily usage pool the preflight gate draws down for billable routes. */
  preflight?: UsageType;
  handler: AuthedRouteHandler;
}

export type OptionalAuthedRouteHandler = (
  rctx: RouteContext & { auth: AuthResult | null },
) => Response | Promise<Response>;

interface OptionalAuthRoute extends RouteLike {
  auth: "optional-jwt";
  handler: OptionalAuthedRouteHandler;
}

export type AppRoute = PublicRoute | ProtectedRoute | OptionalAuthRoute;

type UnauthorizedReason = "missing" | "invalid";

function unauthorizedResponse(
  isStream: boolean,
  reason: UnauthorizedReason,
  corsHeaders: Record<string, string>,
): Response {
  if (isStream) {
    // WebSocket responses are plain text and carry no CORS headers.
    return new Response(
      reason === "missing" ? "Missing token" : "Invalid token",
      { status: 401 },
    );
  }
  return addCorsHeaders(
    error(reason === "missing" ? "UNAUTHORIZED" : "INVALID_TOKEN", 401),
    corsHeaders,
  );
}

/**
 * Extracts the JWT from the request. For WebSocket upgrades the credentials
 * ride in Sec-WebSocket-Protocol — NOT the query string — so the JWT never
 * lands in access logs, referrers, or proxies. Regular requests use the
 * standard `Authorization: Bearer <token>` header.
 */
function extractToken(request: Request, isStream: boolean): string | null {
  if (isStream) {
    const protocols = request.headers.get("Sec-WebSocket-Protocol");
    return protocols ? protocols.split(",")[0].trim() : null;
  }
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function runPipeline(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  routes: AppRoute[],
): Promise<Response> {
  setDebugEnabled(env.APP_ENV !== "production");
  const corsHeaders = getCorsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const matched = matchRoute(routes, request.method, url.pathname);

  // Unknown path: return 404 before auth or the preflight RPC.
  if (!matched) {
    logger.info("[auth] Unknown path probed", { path: url.pathname });
    return addCorsHeaders(
      error(WORKER_ERROR_CODES.NOT_FOUND, 404),
      corsHeaders,
    );
  }
  const { route, params } = matched;
  const isStream = route.auth === "jwt-subprotocol";

  // ─── Public routes (no JWT — signature/Turnstile verified in-handler) ───
  if (route.auth === "none") {
    return addCorsHeaders(
      await route.handler({ request, env, ctx, params }),
      corsHeaders,
    );
  }

  const token = extractToken(request, isStream);

  if (route.auth === "optional-jwt") {
    let auth: AuthResult | null = null;
    if (token) {
      auth = await authenticate(token, env);
    }
    return addCorsHeaders(
      await route.handler({ request, env, ctx, params, auth }),
      corsHeaders,
    );
  }

  // ─── Auth: Strict JWT Only ───
  if (!token) {
    logger.info("[auth] Missing token", { path: url.pathname });
    return unauthorizedResponse(isStream, "missing", corsHeaders);
  }
  const auth = await authenticate(token, env);
  if (!auth) {
    logger.warn("[auth] Invalid token", { path: url.pathname });
    return unauthorizedResponse(isStream, "invalid", corsHeaders);
  }

  // ─── SECURITY GATING: Cloudflare Rate Limiting ───
  if (env.RATE_LIMITER) {
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    const rateLimitKey = clientIp ? `${auth.userId}::${clientIp}` : auth.userId;

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
        tooManyRequests("Rate limit exceeded. Please slow down.", 60),
        corsHeaders,
      );
    }
  }

  const rctx: RouteContext & { auth: AuthResult } = {
    request,
    env,
    ctx,
    params,
    auth,
  };

  // ─── Streaming WebSocket route ───
  // Returns directly: a 101 upgrade Response cannot be rebuilt by the CORS
  // wrapper, and its failure modes are plain-text WebSocket close semantics.
  if (isStream) {
    return route.handler(rctx);
  }

  // ─── PRE-FLIGHT CHECK (ATOMIC COOLDOWN + QUOTA + CACHED) ───
  // Applied only to billable routes. `/usage` deliberately skips the gate:
  // reading your own quota must never consume a cooldown or extend a lock.
  if (route.preflight) {
    const gate = await runPreflightGate(
      env,
      ctx,
      auth.userId,
      auth.tier,
      route.preflight,
      auth.sessionId,
    );
    if (!gate.ok) return addCorsHeaders(gate.response, corsHeaders);
    // The RPC derives the authoritative tier from user_subscriptions (the
    // webhook's write target), so a stale JWT tier is corrected here: every
    // downstream guard/pipeline/cache decision uses the DB-backed tier. A
    // throttled PREMIUM user is never blocked — the request is served with
    // FREE-tier limits (slower cooldown, no premium features) until UTC
    // midnight, so throttling also degrades the effective tier to FREE.
    rctx.auth.tier = gate.preflight.throttled
      ? "FREE"
      : gate.preflight.tier_active;
  }

  // ─── EXECUTION ───
  try {
    const response = await route.handler(rctx);
    return addCorsHeaders(response, corsHeaders);
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (errorMsg === CLIENT_ABORTED) {
      return new Response(null, { status: 499 });
    }
    if (e instanceof HttpError) {
      logger.error("[pipeline] HttpError", { code: e.code, error: errorMsg });
      return addCorsHeaders(
        error(e.code, e.status, e.message, {
          extra: e.extra,
          headers: e.headers,
        }),
        corsHeaders,
      );
    }
    logger.error("[pipeline] Execution error", { error: errorMsg });
    return addCorsHeaders(
      error(
        WORKER_ERROR_CODES.EKWE_SERVER_ERROR,
        500,
        "An unexpected error occurred.",
      ),
      corsHeaders,
    );
  }
}
