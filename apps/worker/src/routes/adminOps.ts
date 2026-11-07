import type { Context } from "hono";
import type { AppEnv } from "@/app";
import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { isProviderDegraded } from "@/services/health";
import { PROVIDER_MODULES } from "@/providers";

async function audit(
  env: Env,
  adminEmail: string,
  action: string,
  detail: string | null,
) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit_log (admin_email, action, target_user_id, detail, created_at) VALUES (?, ?, NULL, ?, ?)",
    )
      .bind(adminEmail, action, detail, Date.now())
      .run();
  } catch (e) {
    logger.warn("[admin-ops] audit failed", { error: String(e) });
  }
}

export async function handleBilling(c: Context<AppEnv>) {
  const env = c.env;
  const userId = c.req.query("userId")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const whereSubs = userId ? "WHERE user_id = ?" : "";
  const subs = await env.DB.prepare(
    `SELECT user_id, status, product_id, platform, expires_at, created_at, updated_at FROM user_subscriptions ${whereSubs} ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(...(userId ? [userId] : []), limit)
    .all()
    .catch(() => ({ results: [] }));
  const whereClaims = userId ? "WHERE user_id = ?" : "";
  const claims = await env.DB.prepare(
    `SELECT flw_ref, user_id, tx_ref, amount, currency, expires_at, claimed_at FROM flutterwave_claims ${whereClaims} ORDER BY claimed_at DESC LIMIT ?`,
  )
    .bind(...(userId ? [userId] : []), limit)
    .all()
    .catch(() => ({ results: [] }));
  return c.json({
    subscriptions: subs.results ?? [],
    claims: claims.results ?? [],
  });
}

export async function handleUsage(c: Context<AppEnv>) {
  const env = c.env;
  const userId = c.req.query("userId")?.trim() ?? "";
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const where = userId ? "WHERE user_id = ?" : "";
  const daily = await env.DB.prepare(
    `SELECT user_id, day, translate_count, transcribe_count, transcribe_ms, speech_chars, stream_count, stream_ms, ai_credits FROM user_daily_usage ${where} ORDER BY day DESC LIMIT ?`,
  )
    .bind(...(userId ? [userId] : []), limit)
    .all()
    .catch(() => ({ results: [] }));
  const monthly = await env.DB.prepare(
    `SELECT user_id, month, translate_count, transcribe_count, transcribe_ms, speech_chars, stream_count, stream_ms, ai_credits FROM user_monthly_usage ${where} ORDER BY month DESC LIMIT ?`,
  )
    .bind(...(userId ? [userId] : []), limit)
    .all()
    .catch(() => ({ results: [] }));
  return c.json({ daily: daily.results ?? [], monthly: monthly.results ?? [] });
}

export async function handleAdminHealth(c: Context<AppEnv>) {
  const env = c.env;
  const names = Object.keys(PROVIDER_MODULES);
  const degradedResults = await Promise.all(
    names.map(async (name) => ({
      name,
      degraded: await isProviderDegraded(env, name).catch(() => false),
    })),
  );
  const degraded = degradedResults.filter((r) => r.degraded).map((r) => r.name);
  let d1 = "ok";
  let kv = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    d1 = "error";
  }
  try {
    await env.EKWE_KV.get("health:probe", { type: "text" });
  } catch {
    kv = "error";
  }
  const pushActive = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM push_tokens WHERE is_active = 1",
  )
    .first()
    .then((r) => (r as unknown as { n: number } | null)?.n ?? 0)
    .catch(() => 0);
  return c.json({
    status: "ok",
    timestamp: Date.now(),
    degradedProviders: degraded,
    bindings: { d1, kv },
    pushActive,
  });
}

export async function handleAuditWrite(c: Context<AppEnv>) {
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const body: unknown = await c.req.json().catch(() => null);
  await audit(
    c.env,
    adminEmail,
    "releases.action",
    body ? JSON.stringify(body).slice(0, 500) : null,
  );
  return c.json({ ok: true });
}
