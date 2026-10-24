import type { Env } from "@/core/types";
import type { Tier } from "@ekwe/shared";
import { normalizeEmail } from "@ekwe/shared";

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  tier: Tier;
  pro_expires_at: number | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_icon: string | null;
  created_at: number;
  updated_at: number;
}

export type IdentityProvider = "email" | "apple" | "google";

export interface UserPayload {
  id: string;
  email: string;
  tier: Tier;
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
  "created_at",
  "updated_at",
];

const SELECT_COLUMNS = COLUMNS.join(", ");
const SELECT_U_COLUMNS = COLUMNS.map((column) => `u.${column}`).join(", ");

export function isPremium(user: UserRow, now = Date.now()): boolean {
  if (user.tier !== "PREMIUM") return false;
  return user.pro_expires_at === null || user.pro_expires_at > now;
}

export function resolveTier(user: UserRow, now = Date.now()): Tier {
  return isPremium(user, now) ? "PREMIUM" : "FREE";
}

export function toPayload(user: UserRow, now = Date.now()): UserPayload {
  return {
    id: user.id,
    email: user.email,
    tier: resolveTier(user, now),
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    avatarIcon: user.avatar_icon,
    proExpiresAt: user.pro_expires_at,
  };
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

  if (linked) {
    await attachIdentity(env, linked.user_id, input, now);
    const existing = await findUserById(env, linked.user_id);
    if (existing) return existing;
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, email_norm, tier, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, 'FREE', ?, ?, ?, ?)
     ON CONFLICT (email_norm) DO NOTHING`,
  )
    .bind(
      crypto.randomUUID(),
      input.email,
      emailNorm,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      now,
      now,
    )
    .run();

  const user = await findUserByEmail(env, emailNorm);
  if (!user) throw new Error("user upsert returned no row");

  if (
    (input.displayName && !user.display_name) ||
    (input.avatarUrl && !user.avatar_url)
  ) {
    await env.DB.prepare(
      `UPDATE users
          SET display_name = COALESCE(display_name, ?),
              avatar_url = COALESCE(avatar_url, ?),
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(input.displayName ?? null, input.avatarUrl ?? null, now, user.id)
      .run();
  }

  await attachIdentity(env, user.id, input, now);
  return (await findUserById(env, user.id)) ?? user;
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
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
}
