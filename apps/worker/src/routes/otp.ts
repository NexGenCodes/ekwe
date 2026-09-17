/**
 * OTP Route — gated email-code dispatch.
 *
 * The mobile app never calls Supabase's auth endpoint directly for OTP send.
 * Requests land here first so we can:
 *   1. Verify a Firebase App Check token (device attestation — fail closed).
 *   2. Optionally verify a Cloudflare Turnstile token (for future web login).
 *   3. Throttle per IP and per email (Durable Object counters).
 *   4. Proxy to Supabase's OTP endpoint with the secret API key and the
 *      end-user IP in `Sb-Forwarded-For`, so Supabase rate-limits each
 *      client's real IP instead of the worker's single egress IP.
 *
 * Responses never reveal whether an email is registered (anti-enumeration):
 * a well-formed request always yields the same success shape.
 */
import { logger } from "../core/logger";
import { Env } from "../core/types";
import { safeParseJSON, tooManyRequests } from "../core/guards";
import { supabaseOtpHeaders, supabasePost } from "../services/supabase";
import { otpRequestSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { createRemoteJWKSet, jwtVerify } from "jose";

// ─── Firebase App Check verification ─────────────────────────────
// Verifies the App Check JWT against Google's public JWKS. The token
// is signed by Firebase and contains the project number in the `aud`
// claim. This proves the request came from an unmodified copy of the
// real app running on a real device (Play Integrity / DeviceCheck).

const FIREBASE_APPCHECK_ISSUER = "https://firebaseappcheck.googleapis.com/";
const FIREBASE_JWKS_URL = new URL(
  "https://firebaseappcheck.googleapis.com/v1/jwks",
);

// Cache the JWKS fetcher at module level so key rotations are handled
// automatically by jose without re-fetching on every request.
const appCheckJWKS = createRemoteJWKSet(FIREBASE_JWKS_URL);

async function verifyAppCheck(token: string, env: Env): Promise<boolean> {
  const projectNumber = env.FIREBASE_PROJECT_NUMBER;
  if (!projectNumber) {
    logger.warn(
      "[otp] FIREBASE_PROJECT_NUMBER not set, cannot verify App Check",
    );
    return false;
  }

  try {
    const expectedAud = [`projects/${projectNumber}`];
    const { payload } = await jwtVerify(token, appCheckJWKS, {
      audience: expectedAud,
    });

    // App Check tokens carry the project *number* as a path segment on the
    // issuer (e.g. https://firebaseappcheck.googleapis.com/239869950724).
    // jose's `issuer` option only supports exact matches, so validate the
    // prefix like the Firebase Admin SDK does instead.
    if (
      typeof payload.iss !== "string" ||
      !payload.iss.startsWith(FIREBASE_APPCHECK_ISSUER) ||
      !payload.sub
    ) {
      logger.warn("[otp] App Check token has invalid issuer or subject", {
        iss: payload.iss,
      });
      return false;
    }

    return true;
  } catch (e) {
    logger.warn("[otp] App Check verification failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// ─── Turnstile siteverify (kept for future web login) ─────────────
// Returns:
//   true  = token valid, or Turnstile unavailable (fail open)
//   false = token explicitly invalid (bad token, wrong action/hostname)

const TURNSTILE_ACTION = "send_otp";

async function verifyTurnstile(
  token: string,
  env: Env,
  clientIp: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  // No secret configured
  if (!secret) {
    if (env.APP_ENV === "development") {
      return true; // Skip verification in local dev
    }
    return false; // Fail closed if secret missing in prod/staging
  }

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

    // Network error or non-2xx → Turnstile unavailable, fail OPEN
    if (!res.ok) {
      logger.warn("[otp] Turnstile siteverify non-OK, failing open", {
        status: res.status,
      });
      return true;
    }

    const result: {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    } = await res.json();

    // Token explicitly invalid (expired, already used, malformed)
    if (result.success === false) {
      const codes = result["error-codes"] ?? [];
      if (codes.includes("invalid-input-response")) {
        return false; // bad/expired/reused token
      }
      // Service-side issue (timeout, internal error) → fail OPEN
      logger.warn("[otp] Turnstile validation failed, failing open", {
        codes,
      });
      return true;
    }

    // Valid token but wrong action/hostname
    if (result.action !== TURNSTILE_ACTION) return false;
    if (
      expectedHostnames.length > 0 &&
      !expectedHostnames.includes(result.hostname ?? "")
    ) {
      return false;
    }
    return true;
  } catch (e) {
    // Network timeout, DNS failure, etc. → Turnstile unavailable, fail OPEN
    logger.warn("[otp] Turnstile siteverify error, failing open", {
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
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
    const stub = env.THROTTLE_DO.getByName(
      "otp",
    ) as unknown as DurableObjectStub;
    const res: Response = await stub.fetch(
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
  // verification and rate limiting, so an unbounded read here would let a
  // malicious client hold an execution slot open with a huge payload.
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = otpRequestSchema.safeParse(parsed.data);
  if (!body.success) {
    const firstPath = body.error.issues[0]?.path[0];
    if (firstPath === "email") {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_EMAIL },
        { status: 400 },
      );
    }
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const { email, turnstileToken, appCheckToken } = body.data;
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

  // ─── Bot protection: App Check (mobile) or Turnstile (future web) ───
  // Accept either token type. If enforcement is on (REQUIRE_APP_CHECK=true)
  // and neither token is present, reject the request in production.
  const headerAppCheck = request.headers.get("X-Firebase-AppCheck");
  const appToken = appCheckToken || headerAppCheck;

  if (appToken) {
    // Mobile path: verify Firebase App Check JWT
    const verified = await verifyAppCheck(appToken, env);
    if (!verified) {
      return Response.json(
        { error: WORKER_ERROR_CODES.TURNSTILE_INVALID },
        { status: 403 },
      );
    }
  } else if (turnstileToken) {
    // Future web path: verify Turnstile token
    const verified = await verifyTurnstile(turnstileToken, env, clientIp);
    if (!verified) {
      return Response.json(
        { error: WORKER_ERROR_CODES.TURNSTILE_INVALID },
        { status: 403 },
      );
    }
  } else if (
    env.REQUIRE_APP_CHECK === "true" &&
    env.APP_ENV !== "development"
  ) {
    // Enforcement is on and no token was provided → reject
    return Response.json(
      { error: WORKER_ERROR_CODES.TURNSTILE_REQUIRED },
      { status: 403 },
    );
  }
  // else: enforcement off or local dev → allow through, rely on rate limiting

  // Per-user (email) and per-IP sends. The per-email bucket is the real
  // per-user abuse gate; the per-IP bucket is only a coarse burst guard and is
  // set high enough that a NAT/office/event where ~50-100 people sign up from
  // one public IP never trips it.
  if (!(await throttled(env, `ip:${clientIp}`, 20, 60))) {
    return tooManyRequests("Please wait a moment.", 60);
  }
  if (!(await throttled(env, `email:${email}`, 4, 600))) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  try {
    // Forward the end-user IP (CF-Connecting-IP) to Supabase so its per-IP
    // rate-limit buckets key on each real client rather than the worker's
    // single egress IP. Requires the secret API key (supabaseOtpHeaders falls
    // back to service-role headers when no secret key is configured).
    const res = await supabasePost(
      env,
      "/auth/v1/otp",
      {
        email,
        create_user: true,
      },
      undefined,
      supabaseOtpHeaders(env, clientIp),
    );

    if (!res || !res.ok) {
      const upstreamBody = res
        ? (await res.text().catch(() => "")).slice(0, 300)
        : "";
      // Include status + upstream body in the message for debugging.
      const status = res?.status ?? 0;
      // Rate limits are expected operational state (Supabase per-IP buckets
      // trip frequently because the Worker funnels all traffic through one
      // egress IP). Warn only — don't flood Sentry with these.
      const isTransient =
        status === 429 || status === 422 || (status >= 500 && status < 600);
      if (isTransient) {
        logger.warn(
          `[otp] Supabase OTP transient error (status ${status}): ${upstreamBody}`,
        );
      } else {
        logger.error(
          `[otp] Supabase OTP error (status ${status}): ${upstreamBody}`,
        );
      }

      // Upstream rate-limit / verification-code flood guard: Supabase returns
      // 429 (or 422 with over_email_send_rate_limit) when its per-IP / per-email
      // buckets trip. Because the Worker funnels ALL OTP sends through one
      // egress IP, the upstream bucket trips far earlier than it would for a
      // direct client. Surface this to the client as a 429 (retryable) instead
      // of a 502 (server error) so the UI stops the user immediately.
      const isRateLimited =
        status === 429 ||
        (status === 422 &&
          /over_.*_send_rate_limit|too.many/.test(upstreamBody));
      if (isRateLimited) {
        const retryAfter = res?.headers.get("Retry-After");
        const seconds = Number(retryAfter) || 60;
        return tooManyRequests(
          "Too many requests. Please try again later.",
          seconds,
        );
      }

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
