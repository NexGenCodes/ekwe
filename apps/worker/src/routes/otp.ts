/**
 * OTP Route — gated email-code dispatch.
 *
 * The mobile app never calls Supabase's auth endpoint directly for OTP send.
 * Requests land here first so we can:
 *   1. Verify the Cloudflare Turnstile token (siteverify — fail closed).
 *   2. Throttle per IP and per email (Durable Object counters).
 *   3. Proxy to Supabase's OTP endpoint with the service-role key.
 *
 * Responses never reveal whether an email is registered (anti-enumeration):
 * a well-formed request always yields the same success shape.
 */
import { logger } from "../core/logger";
import { Env } from "../core/types";
import { safeParseJSON, tooManyRequests } from "../core/guards";
import { supabasePost } from "../services/supabase";
import { otpRequestSchema, WORKER_ERROR_CODES } from "@ekwe/shared";

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

// ─── Per-key throttle (strongly-consistent DO counter) ─────────────
// A KV counter was atomicity-broken here: no atomic increment (two concurrent
// requests both read the same count and both pass) and a 1 write/sec/key cap
// that a spammer's burst trips, silently freezing the count so the throttle
// never engages. The ThrottleBucket DO is single-writer (events serialized),
// so each check atomically increments the current fixed-window bucket.

async function throttled(
  env: Env,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (!env.THROTTLE_DO) return true;
  try {
    const stub = env.THROTTLE_DO.getByName("otp");
    const res = await stub.fetch(
      `https://otp-throttle/allow?key=${encodeURIComponent(key)}&limit=${limit}&windowSec=${windowSec}`,
    );
    if (!res.ok) return true;
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "allowed" in body) {
      return body.allowed === true;
    }
    return true;
  } catch (e) {
    logger.warn("[otp] throttle check failed, allowing request", {
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

// ─── Route handler ────────────────────────────────────────────────

export async function handleSendOtp(
  request: Request,
  env: Env,
): Promise<Response> {
  // Parse the JSON body with a streaming byte cap. The body is consumed before
  // Turnstile and rate limiting, so an unbounded read here would let a
  // malicious client hold an execution slot open with a huge payload.
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = otpRequestSchema.safeParse(parsed.data);
  if (!body.success) {
    // Order matters: report a bad email before a bad token, matching the
    // pre-zod handler so error surfaces don't shift for existing clients.
    const firstPath = body.error.issues[0]?.path[0];
    if (firstPath === "email") {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_EMAIL },
        { status: 400 },
      );
    }
    return Response.json(
      { error: WORKER_ERROR_CODES.TURNSTILE_REQUIRED },
      { status: 403 },
    );
  }

  const { email, turnstileToken: token } = body.data;
  if (!env.TURNSTILE_SECRET) {
    logger.error("[otp] TURNSTILE_SECRET is not configured");
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE },
      { status: 503 },
    );
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

  if (!(await verifyTurnstile(token, env, clientIp))) {
    return Response.json(
      { error: WORKER_ERROR_CODES.TURNSTILE_INVALID },
      { status: 403 },
    );
  }

  if (!(await throttled(env, `ip:${clientIp}`, 5, 60))) {
    return tooManyRequests("Please wait a moment.", 60);
  }
  if (!(await throttled(env, `email:${email}`, 3, 600))) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  try {
    const res = await supabasePost(env, "/auth/v1/otp", { email, create_user: true });

    if (!res || !res.ok) {
      const upstreamBody = res
        ? (await res.text().catch(() => "")).slice(0, 300)
        : "";
      logger.error("[otp] Supabase OTP error", {
        status: res?.status,
        body: upstreamBody,
      });
      return Response.json(
        { error: WORKER_ERROR_CODES.OTP_SEND_FAILED },
        { status: 502 },
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    logger.error("[otp] Supabase network error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.OTP_SEND_FAILED },
      { status: 502 },
    );
  }
}
