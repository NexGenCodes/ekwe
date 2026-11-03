import type { Env } from "@/core/types";
import { REFRESH_TOKEN_TTL_SECONDS } from "@ekwe/shared";
import { randomToken, sha256 } from "@/auth/tokens";

export interface SessionBundle {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: number;
}

export type RotateResult =
  | ({ ok: true; userId: string } & SessionBundle)
  | { ok: false; reason: "unknown" | "expired" | "reuse" };

interface RotationRow {
  session_id: string;
  user_id: string;
  revoked_at: number | null;
  expires_at: number;
}

function expiryFrom(now: number): number {
  return now + REFRESH_TOKEN_TTL_SECONDS * 1000;
}

export async function createSession(
  env: Env,
  userId: string,
  userAgent: string | null,
): Promise<SessionBundle> {
  const sessionId = crypto.randomUUID();
  const refreshToken = randomToken();
  const refreshHash = await sha256(refreshToken);
  const now = Date.now();
  const expiresAt = expiryFrom(now);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_used_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(sessionId, userId, now, now, expiresAt, userAgent),
    env.DB.prepare(
      `INSERT INTO session_rotations (refresh_hash, session_id, issued_at)
       VALUES (?, ?, ?)`,
    ).bind(refreshHash, sessionId, now),
  ]);

  return { sessionId, refreshToken, refreshExpiresAt: expiresAt };
}

export async function rotateSession(
  env: Env,
  refreshToken: string,
): Promise<RotateResult> {
  const refreshHash = await sha256(refreshToken);

  const row = await env.DB.prepare(
    `SELECT r.session_id, s.user_id, s.revoked_at, s.expires_at
       FROM session_rotations r
       JOIN sessions s ON s.id = r.session_id
      WHERE r.refresh_hash = ?`,
  )
    .bind(refreshHash)
    .first<RotationRow>();

  if (!row) return { ok: false, reason: "unknown" };

  const now = Date.now();
  if (row.revoked_at !== null || row.expires_at <= now) {
    return { ok: false, reason: "expired" };
  }

  const nextToken = randomToken();
  const nextHash = await sha256(nextToken);
  const nextExpiry = expiryFrom(now);

  // Atomic spend: exactly one caller can consume this refresh token. A miss
  // means the token was already used, which is either a replay or a stolen
  // copy — revoke the whole session family instead of issuing another token.
  const claim = await env.DB.prepare(
    `UPDATE session_rotations
        SET replaced_by = ?, used_at = ?
      WHERE refresh_hash = ? AND used_at IS NULL
        AND session_id IN (
              SELECT id FROM sessions
               WHERE revoked_at IS NULL AND expires_at > ?
            )
      RETURNING session_id`,
  )
    .bind(nextHash, now, refreshHash, now)
    .all<{ session_id: string }>();

  if (claim.results.length === 0) {
    await revokeSession(env, row.session_id);
    return { ok: false, reason: "reuse" };
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_rotations (refresh_hash, session_id, issued_at)
       VALUES (?, ?, ?)`,
    ).bind(nextHash, row.session_id, now),
    env.DB.prepare(
      `UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?`,
    ).bind(now, nextExpiry, row.session_id),
  ]);

  return {
    ok: true,
    userId: row.user_id,
    sessionId: row.session_id,
    refreshToken: nextToken,
    refreshExpiresAt: nextExpiry,
  };
}

export async function revokeSession(
  env: Env,
  sessionId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), sessionId)
    .run();

  if (env.EKWE_KV) {
    try {
      await env.EKWE_KV.put(`revoked:session:${sessionId}`, "1", {
        expirationTtl: 1800,
      });
    } catch {
      // Best-effort KV tombstone; D1 remains authoritative.
    }
  }
}

export async function sessionIsLive(
  env: Env,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) return false;
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT 1 AS live FROM sessions
      WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(sessionId, now)
    .first<{ live: number }>();
  return row !== null;
}
