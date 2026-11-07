import type { Context } from "hono";
import type { AppEnv } from "@/app";
import type { Env } from "@/core/types";
import { error } from "@/core/http";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { normalizeEmail } from "@ekwe/shared";
import { setProStatus } from "@/services/flutterwave";

async function audit(
  env: Env,
  adminEmail: string,
  action: string,
  target: string | null,
  detail: string | null,
) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit_log (admin_email, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(adminEmail, action, target, detail, Date.now())
      .run();
  } catch (e) {
    logger.warn("[admin] audit insert failed", { error: String(e) });
  }
}

export async function handleListUsers(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const tier = c.req.query("tier")?.toUpperCase() ?? "";
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("email_norm LIKE ?");
    binds.push(`%${q}%`);
  }
  if (tier === "PREMIUM" || tier === "FREE") {
    where.push("tier = ?");
    binds.push(tier);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRow = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users ${whereSql}`,
  )
    .bind(...binds)
    .first()) as unknown as { n: number };
  const rowsRes = (await env.DB.prepare(
    `SELECT id, email, tier, pro_expires_at, display_name, avatar_icon, created_at, updated_at FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all()) as unknown as { results: Record<string, unknown>[] };

  await audit(
    env,
    adminEmail,
    "users.list",
    null,
    `q=${q || "-"} tier=${tier || "-"} limit=${limit} offset=${offset}`,
  );
  return c.json({
    users: rowsRes.results,
    total: countRow?.n ?? 0,
    limit,
    offset,
  });
}

export async function handleSetPro(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as {
    isPro?: unknown;
    expiresAt?: unknown;
  } | null;
  const isPro = body?.isPro === true;
  const expiresAt = typeof body?.expiresAt === "number" ? body.expiresAt : null;

  const applied = await setProStatus(env, { userId: id }, isPro, expiresAt);
  if (!applied.ok) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  await audit(
    env,
    adminEmail,
    isPro ? "users.grant_pro" : "users.revoke_pro",
    id ?? null,
    `expiresAt=${expiresAt ?? "lifetime"}`,
  );
  const user = await env.DB.prepare(
    "SELECT id, email, tier, pro_expires_at, display_name, created_at FROM users WHERE id = ?",
  )
    .bind(id)
    .first();
  return c.json({ ok: true, user });
}

export async function handleListAudit(c: Context<AppEnv>) {
  const env = c.env;
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  try {
    const rows = (await env.DB.prepare(
      "SELECT id, admin_email, action, target_user_id, detail, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT ?",
    )
      .bind(limit)
      .all()) as unknown as { results: Record<string, unknown>[] };
    return c.json({ entries: rows.results });
  } catch {
    return c.json({ entries: [] });
  }
}

export { normalizeEmail };
