/**
 * OTP Route — gated email-code dispatch.
 *
 * The mobile app never calls Supabase's auth endpoint directly for OTP send.
 * Requests land here first so we can:
 *   1. Verify the Cloudflare Turnstile token (siteverify — fail closed).
 *   2. Throttle per IP and per email (KV counters, Cloudflare edge).
 *   3. Proxy to Supabase's OTP endpoint with the service-role key.
 *
 * Responses never reveal whether an email is registered (anti-enumeration):
 * a well-formed request always yields the same success shape.
 */
import { logger } from "../logger";
import { Env } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LEN = 254;
const TURNSTILE_ACTION = "send_otp";

// ─── Turnstile siteverify (canonical) ─────────────────────────────

async function verifyTurnstile(
  token: string,
  env: Env,
  clientIp: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return false;

  const expectedHostnames = (env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          secret,
          response: token,
          remoteip: clientIp,
        }),
      },
    );
    if (!res.ok) return false;

    const result: {
      success?: boolean;
      action?: string;
      hostname?: string;
    } = await res.json();

    if (!result.success || result.action !== TURNSTILE_ACTION) return false;
    if (
      expectedHostnames.length > 0 &&
      !expectedHostnames.includes(result.hostname ?? "")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Per-key throttle (KV counter buckets) ─────────────────────────

async function throttled(
  env: Env,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (!env.EKWE_KV) return true;
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const kvKey = `otp:throttle:${key}:${bucket}`;
  const raw = await env.EKWE_KV.get(kvKey).catch(() => null);
  const count = raw ? Number(raw) : 0;
  if (count >= limit) return false;
  await env.EKWE_KV
    .put(kvKey, String(count + 1), { expirationTtl: windowSec + 5 })
    .catch(() => {});
  return true;
}

// ─── Route handler ────────────────────────────────────────────────

export async function handleSendOtp(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { email?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const token =
    typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX_LEN) {
    return Response.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  if (!token || token.length > 2048) {
    return Response.json({ error: "TURNSTILE_REQUIRED" }, { status: 403 });
  }
  if (!env.TURNSTILE_SECRET) {
    logger.error("[otp] TURNSTILE_SECRET is not configured");
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

  if (!(await verifyTurnstile(token, env, clientIp))) {
    return Response.json({ error: "TURNSTILE_INVALID" }, { status: 403 });
  }

  if (!(await throttled(env, `ip:${clientIp}`, 5, 60))) {
    return Response.json(
      { error: "TOO_MANY_REQUESTS", message: "Please wait a moment." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  if (!(await throttled(env, `email:${email}`, 3, 600))) {
    return Response.json(
      { error: "TOO_MANY_REQUESTS", message: "Please wait a few minutes." },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY || "",
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, create_user: true }),
    });

    if (!res.ok) {
      const upstreamBody = (await res.text()).slice(0, 300);
      logger.error("[otp] Supabase OTP error", {
        status: res.status,
        body: upstreamBody,
      });
      return Response.json({ error: "OTP_SEND_FAILED" }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    logger.error("[otp] Supabase network error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ error: "OTP_SEND_FAILED" }, { status: 502 });
  }
}
