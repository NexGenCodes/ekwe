import { Context, Next } from "hono";
import type { AppEnv } from "@/app";
import type { Tier, UsageType } from "@/core/types";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { error } from "@/core/http";
import { logger } from "@/core/logger";
import { authenticate, isAdminAuthorized } from "@/core/auth";
import { tooManyRequests } from "@/core/guards";
import { runPreflightGate } from "@/services/preflight";

async function rateLimit(
  c: Context<AppEnv>,
  identity: string | null,
  isStream: boolean,
) {
  const env = c.env;
  if (!env.RATE_LIMITER) return null;

  const clientIp = c.req.header("CF-Connecting-IP") || "";
  const key =
    identity && clientIp ? `${identity}::${clientIp}` : identity || clientIp;
  if (!key) return null;

  const timings = c.get("timings");
  const { success } = await timings.measure("rate", () =>
    env.RATE_LIMITER.limit({ key }),
  );
  if (success) return null;

  logger.warn(`[rate-limiter] Blocked request for key: ${key}`);
  if (isStream) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }
  return tooManyRequests("Rate limit exceeded. Please slow down.", 60);
}

function extractToken(req: Request, isStream: boolean): string | null {
  if (isStream) {
    const protocols = req.headers.get("Sec-WebSocket-Protocol");
    return protocols ? protocols.split(",")[0].trim() : null;
  }
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export const authMiddleware =
  (isStream = false) =>
  async (c: Context<AppEnv>, next: Next) => {
    const token = extractToken(c.req.raw, isStream);
    if (!token) {
      logger.info("[auth] Missing token", { path: c.req.path });
      return isStream
        ? new Response("Missing token", { status: 401 })
        : error("UNAUTHORIZED", 401);
    }

    const timings = c.get("timings");
    const auth = await timings.measure("auth", () =>
      authenticate(token, c.env),
    );
    if (!auth) {
      logger.warn("[auth] Invalid token", { path: c.req.path });
      return isStream
        ? new Response("Invalid token", { status: 401 })
        : error("UNAUTHORIZED", 401);
    }

    c.set("auth", auth);
    c.set("tier", auth.tier);
    c.set("pipelineTier", auth.tier);

    const limited = await rateLimit(c, auth.userId, isStream);
    if (limited) return limited;

    await next();
  };

export const optionalAuthMiddleware =
  (isStream = false) =>
  async (c: Context<AppEnv>, next: Next) => {
    const token = extractToken(c.req.raw, isStream);
    let auth = null;
    const timings = c.get("timings");
    if (token) {
      auth = await timings.measure("auth", () => authenticate(token, c.env));
    }

    c.set("auth", auth);
    if (auth) {
      c.set("tier", auth.tier);
      c.set("pipelineTier", auth.tier);
    }

    const limited = await rateLimit(c, auth?.userId ?? null, isStream);
    if (limited) return limited;

    await next();
  };

export const adminAuthMiddleware = async (c: Context<AppEnv>, next: Next) => {
  if (!(await isAdminAuthorized(c.env, c.req.raw))) {
    logger.warn("[auth] Admin secret rejected", { path: c.req.path });
    return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);
  }
  await next();
};

export const preflightMiddleware =
  (usageType: UsageType) => async (c: Context<AppEnv>, next: Next) => {
    const timings = c.get("timings");
    const auth = c.get("auth");
    const gate = await timings.measure("gate", () =>
      runPreflightGate(
        c.env,
        c.executionCtx,
        auth!.userId,
        auth!.tier,
        usageType,
        auth!.sessionId,
      ),
    );
    if (!gate.ok) return gate.response;

    c.set("tier", gate.preflight.tier_active);
    const pipelineTier: Tier = gate.preflight.throttled
      ? "FREE"
      : gate.preflight.tier_active;
    c.set("pipelineTier", pipelineTier);

    if (gate.preflight.throttled) {
      logger.info("[preflight] throttled", {
        userId: auth!.userId,
        type: usageType,
        tier: gate.preflight.tier_active,
        pipelineTier,
        cooldownRemaining: gate.preflight.cooldown_remaining,
      });
    }

    await next();
  };
