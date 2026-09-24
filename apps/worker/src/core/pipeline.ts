import { WORKER_ERROR_CODES, type UsageType } from "@ekwe/shared";
import { authenticate, isAdminAuthorized, type AuthResult } from "@/core/auth";
import { addCorsHeaders, getCorsHeaders } from "@/core/cors";
import { HttpError, error } from "@/core/http";
import { logger, setDebugEnabled } from "@/core/logger";
import { tooManyRequests } from "@/core/guards";
import { matchRoute, type RouteLike } from "@/core/router";
import { runPreflightGate } from "@/services/preflight";
import { CLIENT_ABORTED, type Env } from "@/core/types";
import { recordRequestEvent } from "@/utils/analytics";

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

interface AdminRoute extends RouteLike {
  auth: "admin";
  handler: RouteHandler;
}

export type AppRoute =
  PublicRoute | ProtectedRoute | OptionalAuthRoute | AdminRoute;

type UnauthorizedReason = "missing" | "invalid";

function unauthorizedResponse(
  isStream: boolean,
  reason: UnauthorizedReason,
  corsHeaders: Record<string, string>,
): Response {
  if (isStream) {
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

  if (!matched) {
    logger.info("[auth] Unknown path probed", { path: url.pathname });
    return addCorsHeaders(
      error(WORKER_ERROR_CODES.NOT_FOUND, 404),
      corsHeaders,
    );
  }
  const { route, params } = matched;
  const isStream = route.auth === "jwt-subprotocol";

  const startTime = Date.now();
  const emit = (response: Response, tier = ""): Response => {
    recordRequestEvent(
      env,
      url.pathname,
      response.status,
      Date.now() - startTime,
      tier,
    );
    return addCorsHeaders(response, corsHeaders);
  };

  if (route.auth === "none") {
    return emit(await route.handler({ request, env, ctx, params }));
  }

  if (route.auth === "admin") {
    if (!(await isAdminAuthorized(env, request))) {
      logger.warn("[auth] Admin secret rejected", { path: url.pathname });
      return emit(error(WORKER_ERROR_CODES.UNAUTHORIZED, 401));
    }
    return emit(await route.handler({ request, env, ctx, params }));
  }

  const token = extractToken(request, isStream);

  if (route.auth === "optional-jwt") {
    let auth: AuthResult | null = null;
    if (token) {
      auth = await authenticate(token, env);
    }
    return emit(
      await route.handler({ request, env, ctx, params, auth }),
      auth?.tier ?? "",
    );
  }

  if (!token) {
    logger.info("[auth] Missing token", { path: url.pathname });
    return unauthorizedResponse(isStream, "missing", corsHeaders);
  }
  const auth = await authenticate(token, env);
  if (!auth) {
    logger.warn("[auth] Invalid token", { path: url.pathname });
    return unauthorizedResponse(isStream, "invalid", corsHeaders);
  }

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

  if (isStream) {
    return route.handler(rctx);
  }

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
    rctx.auth.tier = gate.preflight.throttled
      ? "FREE"
      : gate.preflight.tier_active;
  }

  try {
    const response = await route.handler(rctx);
    return emit(response, rctx.auth.tier);
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (errorMsg === CLIENT_ABORTED) {
      return new Response(null, { status: 499 });
    }
    if (e instanceof HttpError) {
      logger.error("[pipeline] HttpError", { code: e.code, error: errorMsg });
      return emit(
        error(e.code, e.status, e.message, {
          extra: e.extra,
          headers: e.headers,
        }),
        rctx.auth.tier,
      );
    }
    logger.error("[pipeline] Execution error", { error: errorMsg });
    return emit(
      error(
        WORKER_ERROR_CODES.EKWE_SERVER_ERROR,
        500,
        "An unexpected error occurred.",
      ),
      rctx.auth.tier,
    );
  }
}
