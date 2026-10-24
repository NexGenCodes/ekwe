import type { Env } from "@/core/types";
import {
  OTP_EXPIRY_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  normalizeEmail,
} from "@ekwe/shared";
import { hmacSha256, randomDigits } from "@/auth/tokens";
import { sendOtpEmail } from "@/services/email";
import { timingSafeEqual } from "@/utils/keys";

export type OtpSendResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfter: number }
  | { ok: false; reason: "email_failed" };

export type OtpVerifyFailReason = "missing" | "expired" | "locked" | "invalid";

export type OtpVerifyResult =
  { ok: true } | { ok: false; reason: OtpVerifyFailReason };

interface OtpRow {
  code_hash: string;
  expires_at: number;
  attempts: number;
  last_sent_at: number;
}

async function codeHash(
  env: Env,
  emailNorm: string,
  code: string,
): Promise<string> {
  return hmacSha256(env.OTP_PEPPER, `${emailNorm}:${code}`);
}

export async function sendOtp(env: Env, email: string): Promise<OtpSendResult> {
  const emailNorm = normalizeEmail(email);
  const now = Date.now();
  const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS * 1000;
  const cutoff = now - cooldownMs;

  const code = randomDigits(6);
  const hash = await codeHash(env, emailNorm, code);

  // Atomic cooldown check + write in a single statement.
  // ON CONFLICT ... WHERE last_sent_at <= cutoff ensures the update only fires
  // when the cooldown window has already expired. Two concurrent requests for
  // the same email cannot both win: D1 serialises writers, and whichever lands
  // second sees last_sent_at from the first winner, fails the WHERE, and gets
  // an empty RETURNING — correctly rejected as still-in-cooldown.
  const claimed = await env.DB.prepare(
    `INSERT INTO otp_codes (email_norm, code_hash, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (email_norm) DO UPDATE SET
       code_hash      = excluded.code_hash,
       expires_at     = excluded.expires_at,
       attempts       = 0,
       last_sent_at   = excluded.last_sent_at
     WHERE otp_codes.last_sent_at <= ?
     RETURNING last_sent_at`,
  )
    .bind(emailNorm, hash, now + OTP_EXPIRY_SECONDS * 1000, now, cutoff)
    .all<{ last_sent_at: number }>();

  if (claimed.results.length === 0) {
    // Row exists but last_sent_at is still inside the cooldown window.
    const row = await env.DB.prepare(
      `SELECT last_sent_at FROM otp_codes WHERE email_norm = ?`,
    )
      .bind(emailNorm)
      .first<{ last_sent_at: number }>();
    const last = row?.last_sent_at ?? cutoff;
    return {
      ok: false,
      reason: "cooldown",
      retryAfter: Math.max(1, Math.ceil((last + cooldownMs - now) / 1000)),
    };
  }

  const sent = await sendOtpEmail(
    env,
    emailNorm,
    code,
    Math.ceil(OTP_EXPIRY_SECONDS / 60),
  );

  if (!sent) {
    await env.DB.prepare(`DELETE FROM otp_codes WHERE email_norm = ?`)
      .bind(emailNorm)
      .run();
    return { ok: false, reason: "email_failed" };
  }

  return { ok: true };
}

export async function consumeOtp(
  env: Env,
  email: string,
  code: string,
): Promise<OtpVerifyResult> {
  const emailNorm = normalizeEmail(email);
  const now = Date.now();

  const row = await env.DB.prepare(
    `SELECT code_hash, expires_at, attempts, last_sent_at
       FROM otp_codes WHERE email_norm = ?`,
  )
    .bind(emailNorm)
    .first<OtpRow>();

  if (!row) return { ok: false, reason: "missing" };

  if (row.expires_at <= now) {
    await env.DB.prepare(`DELETE FROM otp_codes WHERE email_norm = ?`)
      .bind(emailNorm)
      .run();
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }

  const expected = await codeHash(env, emailNorm, code);
  if (!(await timingSafeEqual(expected, row.code_hash))) {
    await env.DB.prepare(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE email_norm = ?`,
    )
      .bind(emailNorm)
      .run();
    return { ok: false, reason: "invalid" };
  }

  await env.DB.prepare(`DELETE FROM otp_codes WHERE email_norm = ?`)
    .bind(emailNorm)
    .run();

  return { ok: true };
}
