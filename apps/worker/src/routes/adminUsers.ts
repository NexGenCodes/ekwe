import type { Context } from "hono";
import type { AppEnv } from "@/app";
import type { Env } from "@/core/types";
import { error } from "@/core/http";
import { WORKER_ERROR_CODES, normalizeEmail } from "@ekwe/shared";
import {
  cancelScheduledDeletion,
  deleteAccount,
  ensureManualPremiumEntitlement,
  getPremiumSources,
  isBootstrapAdminEmail,
  resolveAccountStatus,
  resolveEffectivePremium,
  resolveRole,
  revokeAllSessionsForUser,
  revokeManualPremiumEntitlement,
  scheduleAccountDeletion,
  setUserDisabled,
  setUserRole,
  setUserSuspended,
  syncUserPremiumCache,
  type UserRow,
} from "@/auth/users";

async function audit(
  env: Env,
  adminEmail: string,
  action: string,
  targetUserId: string | null,
  detail: string | null,
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_audit_log (admin_email, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(adminEmail, action, targetUserId, detail, Date.now())
      .run();
  } catch {
    // best-effort
  }
}

const USER_COLUMNS =
  "id, email, email_norm, tier, pro_expires_at, display_name, avatar_icon, disabled_at, disabled_reason, deleted_at, delete_after, COALESCE(role, 'user') AS role, suspended_at, suspended_reason, created_at, updated_at";

const USER_DETAIL_COLUMNS =
  "id, email, email_norm, tier, pro_expires_at, display_name, avatar_url, avatar_icon, disabled_at, disabled_reason, deleted_at, delete_after, COALESCE(role, 'user') AS role, suspended_at, suspended_reason, created_at, updated_at";

async function userToView(env: Env, row: Record<string, unknown>) {
  const user = row as unknown as UserRow;
  const now = Date.now();
  const email = typeof user.email === "string" ? user.email : "";
  const tier = user.tier === "PREMIUM" ? "PREMIUM" : "FREE";
  const expiresAt =
    typeof user.pro_expires_at === "number" ? user.pro_expires_at : null;
  const disabledAt =
    typeof user.disabled_at === "number" ? user.disabled_at : null;
  const suspendedAt =
    typeof user.suspended_at === "number" ? user.suspended_at : null;
  const deletedAt =
    typeof user.deleted_at === "number" ? user.deleted_at : null;
  const deleteAfter =
    typeof user.delete_after === "number" ? user.delete_after : null;
  const role = resolveRole(user);
  const hasPremiumAccess = await resolveEffectivePremium(env, user, now);
  const accountStatus = resolveAccountStatus(user);
  const premiumSources = await getPremiumSources(env, user, now);
  return {
    ...user,
    role,
    accountStatus,
    disabled_at: disabledAt,
    suspended_at: suspendedAt,
    suspended_reason:
      typeof user.suspended_reason === "string" ? user.suspended_reason : null,
    deleted_at: deletedAt,
    delete_after: deleteAfter,
    isAdmin: role === "admin",
    isBootstrapAdmin: isBootstrapAdminEmail(env, email),
    isDisabled: disabledAt !== null,
    isSuspended: suspendedAt !== null,
    isDeletionScheduled: deleteAfter !== null,
    hasPremiumAccess,
    effectiveTier: hasPremiumAccess ? "PREMIUM" : "FREE",
    storedTier: tier,
    pro_expires_at: expiresAt,
    premiumSources,
  };
}

export async function handleListUsers(c: Context<AppEnv>) {
  const env = c.env;
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  const tier = c.req.query("tier")?.toUpperCase() ?? "";
  const access = c.req.query("access")?.toLowerCase() ?? "";
  const role = c.req.query("role")?.toLowerCase() ?? "";
  const status = c.req.query("status")?.toLowerCase() ?? "";
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push(
      "(email_norm LIKE ? OR lower(COALESCE(display_name,'')) LIKE ?)",
    );
    const like = `%${q}%`;
    binds.push(like, like);
  }
  if (tier === "PREMIUM" || tier === "FREE") {
    where.push("tier = ?");
    binds.push(tier);
  }
  if (role === "admin" || role === "user") {
    where.push("COALESCE(role, 'user') = ?");
    binds.push(role);
  }
  if (status === "disabled")
    where.push(
      "disabled_at IS NOT NULL AND delete_after IS NULL AND suspended_at IS NULL",
    );
  if (status === "suspended")
    where.push("suspended_at IS NOT NULL AND delete_after IS NULL");
  if (status === "scheduled_deletion") where.push("delete_after IS NOT NULL");
  if (status === "active")
    where.push(
      "disabled_at IS NULL AND suspended_at IS NULL AND delete_after IS NULL",
    );

  if (access === "premium") {
    where.push(`(
      COALESCE(role, 'user') = 'admin'
      OR (tier = 'PREMIUM' AND (pro_expires_at IS NULL OR pro_expires_at > ?))
      OR EXISTS (
        SELECT 1 FROM user_entitlements e
         WHERE e.user_id = users.id AND e.plan = 'premium' AND e.status = 'active'
           AND e.starts_at <= ? AND (e.expires_at IS NULL OR e.expires_at > ?)
      )
      OR EXISTS (
        SELECT 1 FROM user_subscriptions s
         WHERE s.user_id = users.id AND s.status = 'active'
           AND (s.expires_at IS NULL OR s.expires_at > ?)
      )
    )`);
    const now = Date.now();
    binds.push(now, now, now, now);
  } else if (access === "free") {
    where.push(`(
      COALESCE(role, 'user') != 'admin'
      AND NOT (tier = 'PREMIUM' AND (pro_expires_at IS NULL OR pro_expires_at > ?))
      AND NOT EXISTS (
        SELECT 1 FROM user_entitlements e
         WHERE e.user_id = users.id AND e.plan = 'premium' AND e.status = 'active'
           AND e.starts_at <= ? AND (e.expires_at IS NULL OR e.expires_at > ?)
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_subscriptions s
         WHERE s.user_id = users.id AND s.status = 'active'
           AND (s.expires_at IS NULL OR s.expires_at > ?)
      )
    )`);
    const now = Date.now();
    binds.push(now, now, now, now);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users ${whereSql}`,
  )
    .bind(...binds)
    .first<{ n: number }>()
    .catch(() => null);
  const rowsRes = await env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));

  const users = await Promise.all(
    (rowsRes.results ?? []).map((row) => userToView(env, row)),
  );
  return c.json({ users, total: countRow?.n ?? 0, limit, offset });
}

async function loadUserRow(env: Env, id: string) {
  return env.DB.prepare(`SELECT ${USER_DETAIL_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
}

export async function handleGetUser(c: Context<AppEnv>) {
  const env = c.env;
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const row = await loadUserRow(env, id);
  if (!row) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  return c.json({ user: await userToView(env, row) });
}

export async function handleGetUserDetails(c: Context<AppEnv>) {
  const env = c.env;
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const user = await loadUserRow(env, id);
  if (!user) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);

  const [identities, sessions, pushTokens, entitlements] = await Promise.all([
    env.DB.prepare(
      "SELECT provider, email, created_at, last_used_at FROM identities WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 20",
    )
      .bind(id)
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      "SELECT id, created_at, last_used_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 20",
    )
      .bind(id)
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      "SELECT id, platform, app_version, is_active, last_used_at, created_at FROM push_tokens WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 20",
    )
      .bind(id)
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare(
      "SELECT id, plan, source, status, starts_at, expires_at, granted_by, reason, created_at, updated_at FROM user_entitlements WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(id)
      .all()
      .catch(() => ({ results: [] })),
  ]);

  return c.json({
    identities: identities.results ?? [],
    sessions: sessions.results ?? [],
    pushTokens: pushTokens.results ?? [],
    entitlements: entitlements.results ?? [],
  });
}

export async function handleSetPro(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    isPro?: unknown;
    expiresAt?: unknown;
  } | null;
  const isPro = body?.isPro === true;
  const expiresAt = typeof body?.expiresAt === "number" ? body.expiresAt : null;

  const row = await loadUserRow(env, id);
  if (!row) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);

  if (isPro) {
    await ensureManualPremiumEntitlement(env, id, adminEmail, expiresAt);
  } else {
    await revokeManualPremiumEntitlement(env, id);
  }
  await syncUserPremiumCache(env, id);

  await audit(
    env,
    adminEmail,
    isPro ? "users.grant_pro" : "users.revoke_pro",
    id,
    `source=manual expiresAt=${expiresAt ?? "lifetime"}`,
  );
  const user = await loadUserRow(env, id);
  return c.json({ ok: true, user: user ? await userToView(env, user) : null });
}

export async function handleSetUserRole(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    role?: unknown;
  } | null;
  const role =
    body?.role === "admin" ? "admin" : body?.role === "user" ? "user" : null;
  if (!role) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400, "Invalid role.");

  const user = await setUserRole(env, id, role, adminEmail);
  if (!user) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  await audit(
    env,
    adminEmail,
    role === "admin" ? "users.role_admin" : "users.role_user",
    id,
    `role=${role}`,
  );
  return c.json({
    ok: true,
    user: await userToView(env, user as unknown as Record<string, unknown>),
  });
}

export async function handleRevokeUserSessions(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const user = await loadUserRow(env, id);
  if (!user) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  const count = await revokeAllSessionsForUser(env, id);
  await audit(env, adminEmail, "users.revoke_sessions", id, `count=${count}`);
  return c.json({ ok: true, revoked: count });
}

export async function handleSetUserDisabled(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    disabled?: unknown;
    reason?: unknown;
  } | null;
  const disabled = body?.disabled === true;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;

  const ok = await setUserDisabled(env, id, disabled, reason);
  if (!ok) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  let revoked = 0;
  if (disabled) revoked = await revokeAllSessionsForUser(env, id);
  await audit(
    env,
    adminEmail,
    disabled ? "users.disable" : "users.enable",
    id,
    `reason=${reason ?? "-"} revoked=${revoked}`,
  );
  const user = await loadUserRow(env, id);
  return c.json({
    ok: true,
    revoked,
    user: user ? await userToView(env, user) : null,
  });
}

export async function handleSetUserSuspended(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    suspended?: unknown;
    reason?: unknown;
  } | null;
  const suspended = body?.suspended === true;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;

  const ok = await setUserSuspended(env, id, suspended, reason);
  if (!ok) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  let revoked = 0;
  if (suspended) revoked = await revokeAllSessionsForUser(env, id);
  await audit(
    env,
    adminEmail,
    suspended ? "users.suspend" : "users.unsuspend",
    id,
    `reason=${reason ?? "-"} revoked=${revoked}`,
  );
  const user = await loadUserRow(env, id);
  return c.json({
    ok: true,
    revoked,
    user: user ? await userToView(env, user) : null,
  });
}

export async function handleDeleteUser(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    confirmEmail?: unknown;
  } | null;
  const row = await loadUserRow(env, id);
  if (!row) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  const email = typeof row.email === "string" ? row.email : "";
  const confirmEmail =
    typeof body?.confirmEmail === "string"
      ? body.confirmEmail.trim().toLowerCase()
      : "";
  if (!confirmEmail || confirmEmail !== email.trim().toLowerCase()) {
    return error(
      WORKER_ERROR_CODES.BAD_REQUEST,
      400,
      "Confirmation email does not match.",
    );
  }

  await audit(
    env,
    adminEmail,
    "users.delete",
    id,
    `email=${normalizeEmail(email)} mode=immediate`,
  );
  await revokeAllSessionsForUser(env, id);
  if (env.EKWE_KV) {
    await env.EKWE_KV.put(`disabled:user:${id}`, "1", {
      expirationTtl: 60 * 60 * 24 * 30,
    }).catch(() => undefined);
  }
  await deleteAccount(env, id);
  return c.json({ ok: true });
}

export async function handleScheduleDeleteUser(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const body = (await c.req.json().catch(() => null)) as {
    days?: unknown;
  } | null;
  const days = typeof body?.days === "number" ? body.days : 30;
  const row = await loadUserRow(env, id);
  if (!row) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  const deleteAfter = await scheduleAccountDeletion(env, id, days);
  if (!deleteAfter) return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  const revoked = await revokeAllSessionsForUser(env, id);
  await audit(
    env,
    adminEmail,
    "users.delete_scheduled",
    id,
    `deleteAfter=${deleteAfter} revoked=${revoked}`,
  );
  const user = await loadUserRow(env, id);
  return c.json({
    ok: true,
    deleteAfter,
    revoked,
    user: user ? await userToView(env, user) : null,
  });
}

export async function handleCancelScheduledDeleteUser(c: Context<AppEnv>) {
  const env = c.env;
  const adminEmail = c.get("adminEmail") ?? "unknown";
  const id = c.req.param("id");
  if (!id) return error(WORKER_ERROR_CODES.BAD_REQUEST, 400);
  const ok = await cancelScheduledDeletion(env, id);
  if (!ok)
    return error(
      WORKER_ERROR_CODES.BAD_REQUEST,
      400,
      "No scheduled deletion to cancel.",
    );
  await audit(env, adminEmail, "users.delete_cancelled", id, null);
  const user = await loadUserRow(env, id);
  return c.json({ ok: true, user: user ? await userToView(env, user) : null });
}

export async function handleListAudit(c: Context<AppEnv>) {
  const env = c.env;
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const userId = c.req.query("userId")?.trim() ?? "";
  const action = c.req.query("action")?.trim() ?? "";
  const q = c.req.query("q")?.trim().toLowerCase() ?? "";
  try {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (userId) {
      where.push("target_user_id = ?");
      binds.push(userId);
    }
    if (action) {
      where.push("action = ?");
      binds.push(action);
    }
    if (q) {
      where.push(
        "(lower(action) LIKE ? OR lower(admin_email) LIKE ? OR lower(COALESCE(detail,'')) LIKE ?)",
      );
      const like = `%${q}%`;
      binds.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit_log ${whereSql}`,
    )
      .bind(...binds)
      .first<{ n: number }>();
    const rows = await env.DB.prepare(
      `SELECT id, admin_email, action, target_user_id, detail, created_at FROM admin_audit_log ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all<Record<string, unknown>>();
    const entries = rows.results ?? [];
    const total = countRow?.n ?? 0;
    return c.json({
      entries,
      total,
      limit,
      offset,
      hasMore: offset + entries.length < total,
    });
  } catch {
    return c.json({ entries: [], total: 0, limit, offset, hasMore: false });
  }
}
