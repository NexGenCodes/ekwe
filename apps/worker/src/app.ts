import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { Env, Tier } from "@/core/types";
import type { AuthResult } from "@/core/auth";
import { RequestTimings } from "@/core/timing";
import { isDevOrigin } from "@/core/cors";
import { recordRequestEvent } from "@/utils/analytics";
import {
  MAX_HISTORY_BATCH_BYTES,
  SYNC_PULL_ROWS,
  WORKER_ERROR_CODES,
  syncPushRows,
} from "@ekwe/shared";
import { HttpError, error } from "@/core/http";
import { HTTPException } from "hono/http-exception";
import { CLIENT_ABORTED } from "@/core/types";
import { logger, setDebugEnabled } from "@/core/logger";
import { isWorkersPaid } from "@/core/env";
import { isProviderDegraded } from "@/services/health";
import { PROVIDER_MODULES } from "@/providers";
import { handleStorePricing } from "@/routes/pricing";
import { handleWebhook } from "@/routes/webhook";
import { handleGetUpdateManifest } from "@/routes/admin";

import { authRouter } from "@/auth/router";
import { publicJwks } from "@/auth/jwt";
import { billingRouter, usageRouter } from "@/routers/auth-billing";
import { speechRouter } from "@/routers/speech";
import { adminRouter, deviceRouter } from "@/routers/admin";
import { syncRouter } from "@/routers/sync";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: AuthResult | null;
    timings: RequestTimings;
    tier: Tier;
    pipelineTier: Tier;
    adminEmail: string;
  };
};

export const app = new Hono<AppEnv>();

// ── Global middleware ─────────────────────────────────────────────────
app.use(
  "*",
  cors({
    origin: (origin, c: Context<AppEnv>) => {
      setDebugEnabled(c.env.APP_ENV !== "production");
      if (!origin) return "";

      const allowedOrigins =
        c.env.ALLOWED_ORIGINS?.split(",")
          .map((o: string) => o.trim())
          .filter(Boolean) || [];

      const isDev = c.env.APP_ENV !== "production" && isDevOrigin(origin);
      const isExactMatch = allowedOrigins.includes(origin);

      return isExactMatch || isDev ? origin : "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Firebase-AppCheck"],
    exposeHeaders: ["Server-Timing", "Retry-After"],
  }),
);

app.use("*", async (c, next) => {
  const startTime = Date.now();
  const timings = new RequestTimings();
  c.set("timings", timings);
  c.set("tier", "FREE" as Tier);
  c.set("pipelineTier", "FREE" as Tier);

  const url = new URL(c.req.url);

  await next();

  const res = c.res;
  const totalMs = Date.now() - startTime;
  const tier = c.get("tier") || "";
  recordRequestEvent(c.env, url.pathname, res.status, totalMs, tier);

  if (!c.res.headers.has("Server-Timing")) {
    const serverTiming = timings.toServerTiming(totalMs);
    if (serverTiming) {
      c.res = new Response(c.res.body, c.res);
      c.res.headers.append("Server-Timing", serverTiming);
    }
  }
});

// ── Error handling ────────────────────────────────────────────────────
app.onError((e, c) => {
  if (
    e instanceof SyntaxError ||
    (e instanceof HTTPException &&
      e.status === 400 &&
      e.message.includes("JSON"))
  ) {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  const errorMsg = e instanceof Error ? e.message : String(e);
  if (errorMsg === CLIENT_ABORTED) {
    return new Response(null, { status: 499 });
  }
  if (e instanceof HttpError) {
    logger.error("[pipeline] HttpError", { code: e.code, error: errorMsg });
    return error(e.code, e.status, e.message, {
      extra: e.extra,
      headers: e.headers,
    });
  }
  logger.error("[pipeline] Execution error", { error: errorMsg });
  return error(
    WORKER_ERROR_CODES.EKWE_SERVER_ERROR,
    500,
    "An unexpected error occurred.",
  );
});

app.notFound((c) => {
  return c.json({ error: "NOT_FOUND" }, 404);
});

// ── Standalone routes ─────────────────────────────────────────────────
app.get("/health", async (c) => {
  const providerNames = Object.keys(PROVIDER_MODULES);
  const degradedResults = await Promise.all(
    providerNames.map(async (name) => ({
      name,
      degraded: await isProviderDegraded(c.env, name),
    })),
  );
  const degraded = degradedResults.filter((r) => r.degraded).map((r) => r.name);

  let d1 = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").bind().first();
  } catch {
    d1 = "error";
  }
  let kv = "ok";
  try {
    await c.env.EKWE_KV.get("health:probe", { type: "text" });
  } catch {
    kv = "error";
  }

  return c.json({
    status: "ok",
    timestamp: Date.now(),
    degradedProviders: degraded,
    bindings: { d1, kv },
  });
});

app.get("/pricing", (c) =>
  handleStorePricing(
    c.req.raw,
    c.env,
    c.executionCtx as unknown as ExecutionContext,
  ),
);

app.get("/config", (c) =>
  c.json(
    {
      syncPullRows: SYNC_PULL_ROWS,
      syncPushRows: syncPushRows(isWorkersPaid(c.env)),
      maxHistoryBatchBytes: MAX_HISTORY_BATCH_BYTES,
    },
    200,
    { "Cache-Control": "public, max-age=300" },
  ),
);

app.post("/webhook", (c) =>
  handleWebhook(
    c.req.raw,
    c.env,
    c.executionCtx as unknown as ExecutionContext,
  ),
);

app.get("/update/manifest", (c) =>
  handleGetUpdateManifest(
    c.req.raw,
    c.env,
    c.executionCtx as unknown as ExecutionContext,
  ),
);

app.get("/.well-known/jwks.json", (c) => {
  return c.json(publicJwks(c.env), 200, {
    "Cache-Control": "public, max-age=3600",
  });
});

// ── Mounted sub-routers ───────────────────────────────────────────────
app.route("/auth", authRouter);
app.route("/billing", billingRouter);
app.route("/usage", usageRouter);
app.route("/sync", syncRouter);
app.route("/devices", deviceRouter);
app.route("/admin", adminRouter);
app.route("/", speechRouter);
