import type { Env } from "@/core/types";
import type { Tier } from "@ekwe/shared";
import { normalizeEmail } from "@ekwe/shared";

export type UserRole = "user" | "admin";

export type AccountStatus =
  "active" | "disabled" | "suspended" | "scheduled_deletion";

export type EntitlementSource = "staff" | "manual" | "billing" | "promo";

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  tier: Tier;
  pro_expires_at: number | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_icon: string | null;
  disabled_at: number | null;
  disabled_reason: string | null;
  deleted_at: number | null;
  delete_after: number | null;
  role: UserRole;
  suspended_at: number | null;
  suspended_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  plan: "premium";
  source: EntitlementSource;
  status: "active" | "revoked" | "expired";
  starts_at: number;
  expires_at: number | null;
  granted_by: string | null;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

export type IdentityProvider = "email" | "apple" | "google";

export interface UserPayload {
  id: string;
  email: string;
  tier: Tier;
  role: UserRole;
  accountStatus: AccountStatus;
  displayName: string | null;
  avatarUrl: string | null;
  avatarIcon: string | null;
  proExpiresAt: number | null;
}

const COLUMNS = [
  "id",
  "email",
  "email_norm",
  "tier",
  "pro_expires_at",
  "display_name",
  "avatar_url",
  "avatar_icon",
  "disabled_at",
  "disabled_reason",
  "deleted_at",
  "delete_after",
  "COALESCE(role, 'user') AS role",
  "suspended_at",
  "suspended_reason",
  "created_at",
  "updated_at",
];

const SELECT_COLUMNS = COLUMNS.join(", ");
const SELECT_U_COLUMNS = COLUMNS.map((column) =>
  column.includes(" AS ")
    ? column.replace(/^(.+) AS (.+)$/, "$1 AS $2")
    : `u.${column}`,
).join(", ");

function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

export function getAdminEmails(env: Env): string[] {
  const raw = env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdminEmail(
  env: Env,
  email: string | undefined | null,
): boolean {
  if (!email) return false;
  return getAdminEmails(env).includes(email.toLowerCase());
}

export function resolveRole(user: Pick<UserRow, "role">): UserRole {
  return normalizeRole(user.role);
}

export function resolveAccountStatus(
  user: Pick<UserRow, "disabled_at" | "delete_after" | "suspended_at">,
): AccountStatus {
  if (user.delete_after != null) return "scheduled_deletion";
  if (user.suspended_at != null) return "suspended";
  if (user.disabled_at != null) return "disabled";
  return "active";
}

export function isAccountActive(
  user: Pick<UserRow, "disabled_at" | "delete_after" | "suspended_at">,
): boolean {
  return resolveAccountStatus(user) === "active";
}

export function isAccountBlocked(
  user: Pick<UserRow, "disabled_at" | "delete_after" | "suspended_at">,
): boolean {
  return resolveAccountStatus(user) !== "active";
}

export function isAccountDisabled(
  user: Pick<UserRow, "disabled_at" | "delete_after" | "suspended_at">,
): boolean {
  return isAccountBlocked(user);
}

export function isDeletionScheduled(
  user: Pick<UserRow, "delete_after">,
): boolean {
  return user.delete_after != null;
}

export function isPremium(
  user: Pick<UserRow, "tier" | "pro_expires_at">,
  now = Date.now(),
): boolean {
  if (user.tier !== "PREMIUM") return false;
  return user.pro_expires_at == null || user.pro_expires_at > now;
}

async function listActivePremiumEntitlements(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<Array<Pick<EntitlementRow, "source" | "expires_at">>> {
  try {
    const res = await env.DB.prepare(
      `SELECT source, expires_at FROM user_entitlements
        WHERE user_id = ? AND plan = 'premium' AND status = 'active'
          AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC, expires_at DESC`,
    )
      .bind(userId, now, now)
      .all<Pick<EntitlementRow, "source" | "expires_at">>();
    return res.results ?? [];
  } catch {
    return [];
  }
}

async function hasActiveSubscription(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM user_subscriptions
        WHERE user_id = ? AND status = 'active'
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1`,
    )
      .bind(userId, now)
      .first<{ ok: number }>();
    return !!row;
  } catch {
    return false;
  }
}

export async function getPremiumSources(
  env: Env,
  user: UserRow,
  now = Date.now(),
): Promise<string[]> {
  const sources = new Set<string>();
  if (resolveRole(user) === "admin") sources.add("admin_role");
  const entitlements = await listActivePremiumEntitlements(env, user.id, now);
  for (const e of entitlements) sources.add(e.source);
  if (await hasActiveSubscription(env, user.id, now))
    sources.add("subscription");
  return [...sources];
}

export async function resolveEffectivePremium(
  env: Env,
  user: UserRow,
  now = Date.now(),
): Promise<boolean> {
  if (resolveRole(user) === "admin") return true;
  const entitlements = await listActivePremiumEntitlements(env, user.id, now);
  if (entitlements.length > 0) return true;
  if (await hasActiveSubscription(env, user.id, now)) return true;
  return false;
}

export async function isPremiumWithAdmin(
  env: Env,
  user: UserRow,
  now = Date.now(),
): Promise<boolean> {
  return resolveEffectivePremium(env, user, now);
}

export async function resolveTierWithAdmin(
  env: Env,
  user: UserRow,
  now = Date.now(),
): Promise<Tier> {
  return (await resolveEffectivePremium(env, user, now)) ? "PREMIUM" : "FREE";
}

export function resolveTier(user: UserRow, now = Date.now()): Tier {
  return isPremium(user, now) ? "PREMIUM" : "FREE";
}

export async function toPayload(
  env: Env,
  user: UserRow,
  now = Date.now(),
): Promise<UserPayload> {
  return {
    id: user.id,
    email: user.email,
    tier: await resolveTierWithAdmin(env, user, now),
    role: resolveRole(user),
    accountStatus: resolveAccountStatus(user),
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    avatarIcon: user.avatar_icon,
    proExpiresAt: user.pro_expires_at,
  };
}

async function syncUserBlockKv(env: Env, userId: string): Promise<void> {
  if (!env.EKWE_KV) return;
  const key = `disabled:user:${userId}`;
  try {
    const row = await env.DB.prepare(
      `SELECT disabled_at, delete_after, suspended_at FROM users WHERE id = ?`,
    )
      .bind(userId)
      .first<{
        disabled_at: number | null;
        delete_after: number | null;
        suspended_at: number | null;
      }>();
    const blocked =
      row?.disabled_at != null ||
      row?.delete_after != null ||
      row?.suspended_at != null;
    if (blocked) {
      await env.EKWE_KV.put(key, "1", { expirationTtl: 60 * 60 * 24 * 30 });
    } else {
      await env.EKWE_KV.delete(key);
    }
  } catch {
    // best-effort
  }
}

async function upsertActiveEntitlement(
  env: Env,
  userId: string,
  source: EntitlementSource,
  expiresAt: number | null,
  grantedBy: string | null,
  reason: string | null,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE user_entitlements
        SET status = 'revoked', updated_at = ?
      WHERE user_id = ? AND source = ? AND plan = 'premium' AND status = 'active'`,
  )
    .bind(now, userId, source)
    .run();
  await env.DB.prepare(
    `INSERT INTO user_entitlements
       (id, user_id, plan, source, status, starts_at, expires_at, granted_by, reason, created_at, updated_at)
     VALUES (?, ?, 'premium', ?, 'active', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      source,
      now,
      expiresAt,
      grantedBy,
      reason,
      now,
      now,
    )
    .run();
}

async function revokeActiveEntitlement(
  env: Env,
  userId: string,
  source: EntitlementSource,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE user_entitlements
        SET status = 'revoked', expires_at = COALESCE(expires_at, ?), updated_at = ?
      WHERE user_id = ? AND source = ? AND plan = 'premium' AND status = 'active'`,
  )
    .bind(now, now, userId, source)
    .run();
}

export async function ensureStaffPremiumEntitlement(
  env: Env,
  userId: string,
  grantedBy: string | null,
  reason = "Default admin entitlement",
): Promise<void> {
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM user_entitlements
        WHERE user_id = ? AND source = 'staff' AND plan = 'premium' AND status = 'active'
        LIMIT 1`,
    )
      .bind(userId)
      .first<{ id: string }>();
    if (existing) return;
    await upsertActiveEntitlement(
      env,
      userId,
      "staff",
      null,
      grantedBy,
      reason,
    );
  } catch {
    // table may not exist during rollout
  }
}

export async function revokeStaffPremiumEntitlement(
  env: Env,
  userId: string,
): Promise<void> {
  try {
    await revokeActiveEntitlement(env, userId, "staff");
  } catch {
    // ignore
  }
}

export async function ensureManualPremiumEntitlement(
  env: Env,
  userId: string,
  grantedBy: string | null,
  expiresAt: number | null,
): Promise<void> {
  try {
    await upsertActiveEntitlement(
      env,
      userId,
      "manual",
      expiresAt,
      grantedBy,
      expiresAt == null
        ? "Manual lifetime premium grant"
        : "Manual premium grant",
    );
  } catch {
    // ignore
  }
}

export async function revokeManualPremiumEntitlement(
  env: Env,
  userId: string,
): Promise<void> {
  try {
    await revokeActiveEntitlement(env, userId, "manual");
  } catch {
    // ignore
  }
}

export async function syncBillingEntitlement(
  env: Env,
  userId: string,
  active: boolean,
  expiresAt: number | null,
): Promise<void> {
  try {
    if (active) {
      await upsertActiveEntitlement(
        env,
        userId,
        "billing",
        expiresAt,
        "system:billing",
        "Billing entitlement",
      );
    } else {
      await revokeActiveEntitlement(env, userId, "billing");
    }
  } catch {
    // ignore
  }
}

export async function syncUserPremiumCache(
  env: Env,
  userId: string,
): Promise<void> {
  const user = await findUserById(env, userId);
  if (!user) return;
  const now = Date.now();
  const effective = await resolveEffectivePremium(env, user, now);
  const entitlements = await listActivePremiumEntitlements(env, userId, now);
  // cache expiry: prefer nearest finite expiry among active premium entitlements/subscription if not lifetime
  let cacheExpiry: number | null = null;
  if (effective) {
    const finite: number[] = [];
    for (const e of entitlements) {
      if (e.expires_at != null) finite.push(e.expires_at);
    }
    try {
      const sub = await env.DB.prepare(
        `SELECT expires_at FROM user_subscriptions
          WHERE user_id = ? AND status = 'active'
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC, expires_at DESC LIMIT 1`,
      )
        .bind(userId, now)
        .first<{ expires_at: number | null }>();
      if (sub?.expires_at != null) finite.push(sub.expires_at);
      if (sub && sub.expires_at == null) cacheExpiry = null;
    } catch {
      /* ignore */
    }
    // if any source is lifetime-like (admin role or null-expiry entitlement) keep null
    const hasLifetime =
      resolveRole(user) === "admin" ||
      entitlements.some((e) => e.expires_at == null);
    if (hasLifetime) cacheExpiry = null;
    else if (finite.length > 0) cacheExpiry = Math.max(...finite);
    else if (isPremium(user, now) && user.pro_expires_at != null)
      cacheExpiry = user.pro_expires_at;
  }
  try {
    await env.DB.prepare(
      `UPDATE users SET tier = ?, pro_expires_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        effective ? "PREMIUM" : "FREE",
        effective ? cacheExpiry : null,
        now,
        userId,
      )
      .run();
  } catch {
    // ignore
  }
}

export async function bootstrapAdminAccount(
  env: Env,
  email: string,
): Promise<void> {
  if (!isBootstrapAdminEmail(env, email)) return;
  const user = await findUserByEmail(env, email);
  if (!user) return;
  const now = Date.now();
  if (resolveRole(user) !== "admin") {
    try {
      await env.DB.prepare(
        `UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`,
      )
        .bind(now, user.id)
        .run();
    } catch {
      /* ignore */
    }
  }
  await ensureStaffPremiumEntitlement(env, user.id, "bootstrap:ADMIN_EMAILS");
  await syncUserPremiumCache(env, user.id);
}

export function findUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
}

export function findUserByEmail(
  env: Env,
  email: string,
): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE email_norm = ?`,
  )
    .bind(normalizeEmail(email))
    .first<UserRow>();
}

export function findUserByIdentity(
  env: Env,
  provider: IdentityProvider,
  providerUserId: string,
): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT ${SELECT_U_COLUMNS}
       FROM users u
       JOIN identities i ON i.user_id = u.id
      WHERE i.provider = ? AND i.provider_user_id = ?`,
  )
    .bind(provider, providerUserId)
    .first<UserRow>();
}

export interface IdentityInput {
  email: string;
  provider: IdentityProvider;
  providerUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

async function attachIdentity(
  env: Env,
  userId: string,
  input: IdentityInput,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO identities (provider, provider_user_id, user_id, email, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET last_used_at = excluded.last_used_at`,
  )
    .bind(input.provider, input.providerUserId, userId, input.email, now, now)
    .run();
}

export async function findOrCreateUser(
  env: Env,
  input: IdentityInput,
): Promise<UserRow> {
  const emailNorm = normalizeEmail(input.email);
  const now = Date.now();

  const linked = await env.DB.prepare(
    `SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?`,
  )
    .bind(input.provider, input.providerUserId)
    .first<{ user_id: string }>();

  let user: UserRow | null = null;
  if (linked) user = await findUserById(env, linked.user_id);
  if (!user) user = await findUserByEmail(env, emailNorm);

  if (!user) {
    const newUserId = crypto.randomUUID();
    const bootstrapAdmin = isBootstrapAdminEmail(env, input.email);
    await env.DB.prepare(
      `INSERT INTO users (id, email, email_norm, tier, role, display_name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, 'FREE', ?, ?, ?, ?, ?)
       ON CONFLICT (email_norm) DO NOTHING`,
    )
      .bind(
        newUserId,
        input.email,
        emailNorm,
        bootstrapAdmin ? "admin" : "user",
        input.displayName ?? null,
        input.avatarUrl ?? null,
        now,
        now,
      )
      .run();
    user = await findUserByEmail(env, emailNorm);
    if (!user) {
      throw new Error("Failed to create user");
    }
    if (resolveRole(user) === "admin") {
      await ensureStaffPremiumEntitlement(
        env,
        user.id,
        "bootstrap:ADMIN_EMAILS",
      );
      await syncUserPremiumCache(env, user.id);
      user = (await findUserById(env, user.id)) ?? user;
    }
  }

  await attachIdentity(env, user.id, input, now);
  user = (await findUserById(env, user.id)) ?? user;
  return user;
}

export async function updateProfile(
  env: Env,
  userId: string,
  patch: { displayName?: string | null; avatarIcon?: string | null },
): Promise<UserRow | null> {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.displayName !== undefined) {
    assignments.push("display_name = ?");
    values.push(patch.displayName || null);
  }
  if (patch.avatarIcon !== undefined) {
    assignments.push("avatar_icon = ?");
    values.push(patch.avatarIcon || null);
  }
  if (assignments.length === 0) return findUserById(env, userId);

  assignments.push("updated_at = ?");
  values.push(Date.now(), userId);

  await env.DB.prepare(
    `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`,
  )
    .bind(...values)
    .run();

  return findUserById(env, userId);
}

export async function setUserRole(
  env: Env,
  userId: string,
  role: UserRole,
  actor: string | null,
): Promise<UserRow | null> {
  const now = Date.now();
  try {
    await env.DB.prepare(
      `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(role, now, userId)
      .run();
  } catch {
    return null;
  }
  if (role === "admin") {
    await ensureStaffPremiumEntitlement(
      env,
      userId,
      actor,
      "Admin role granted",
    );
  } else {
    await revokeStaffPremiumEntitlement(env, userId);
  }
  await syncUserPremiumCache(env, userId);
  return findUserById(env, userId);
}

export async function revokeAllSessionsForUser(
  env: Env,
  userId: string,
): Promise<number> {
  const sessions = await env.DB.prepare(
    `SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(userId)
    .all<{ id: string }>();
  const ids = (sessions.results ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(now, userId)
    .run();
  if (env.EKWE_KV) {
    await Promise.all(
      ids.map((id) =>
        env.EKWE_KV.put(`revoked:session:${id}`, "1", {
          expirationTtl: 1800,
        }).catch(() => undefined),
      ),
    );
  }
  return ids.length;
}

export async function setUserSuspended(
  env: Env,
  userId: string,
  suspended: boolean,
  reason: string | null,
): Promise<boolean> {
  const now = Date.now();
  const result = await env.DB.prepare(
    suspended
      ? `UPDATE users SET suspended_at = ?, suspended_reason = ?, updated_at = ? WHERE id = ?`
      : `UPDATE users SET suspended_at = NULL, suspended_reason = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(...(suspended ? [now, reason, now, userId] : [now, userId]))
    .run();
  if (!result.meta.changes) return false;
  await syncUserBlockKv(env, userId);
  return true;
}

export async function setUserDisabled(
  env: Env,
  userId: string,
  disabled: boolean,
  reason: string | null,
): Promise<boolean> {
  const now = Date.now();
  const result = await env.DB.prepare(
    disabled
      ? `UPDATE users SET disabled_at = ?, disabled_reason = ?, updated_at = ? WHERE id = ?`
      : `UPDATE users SET disabled_at = NULL, disabled_reason = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(...(disabled ? [now, reason, now, userId] : [now, userId]))
    .run();
  if (!result.meta.changes) return false;
  await syncUserBlockKv(env, userId);
  return true;
}

export async function scheduleAccountDeletion(
  env: Env,
  userId: string,
  days = 30,
): Promise<number | null> {
  const now = Date.now();
  const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
  const deleteAfter = now + safeDays * 86_400_000;
  const result = await env.DB.prepare(
    `UPDATE users
        SET deleted_at = ?, delete_after = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(now, deleteAfter, now, userId)
    .run();
  if (!result.meta.changes) return null;
  await syncUserBlockKv(env, userId);
  return deleteAfter;
}

export async function cancelScheduledDeletion(
  env: Env,
  userId: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE users
        SET deleted_at = NULL, delete_after = NULL, updated_at = ?
      WHERE id = ? AND delete_after IS NOT NULL`,
  )
    .bind(now, userId)
    .run();
  if (!result.meta.changes) return false;
  await syncUserBlockKv(env, userId);
  return true;
}

export async function deleteAccount(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM session_rotations WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)`,
    ).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM identities WHERE user_id = ?`).bind(userId),
    env.DB.prepare(
      `DELETE FROM otp_codes WHERE email_norm = (SELECT email_norm FROM users WHERE id = ?)`,
    ).bind(userId),
    env.DB.prepare(`DELETE FROM history WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_subscriptions WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`DELETE FROM user_daily_usage WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`DELETE FROM user_monthly_usage WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`DELETE FROM flutterwave_claims WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`DELETE FROM push_tokens WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_entitlements WHERE user_id = ?`).bind(
      userId,
    ),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}

export function isAdminUser(user: UserRow): boolean {
  return resolveRole(user) === "admin";
}
