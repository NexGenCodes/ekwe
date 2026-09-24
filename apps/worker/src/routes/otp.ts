import { logger } from "@/core/logger";
import { Env } from "@/core/types";
import {
  safeParseJSON,
  tooManyRequests,
  guardContentType,
} from "@/core/guards";
import { supabaseOtpHeaders, supabasePost } from "@/services/supabase";
import { otpRequestSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_APPCHECK_ISSUER = "https://firebaseappcheck.googleapis.com/";
const FIREBASE_JWKS_URL = new URL(
  "https://firebaseappcheck.googleapis.com/v1/jwks",
);

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

const TURNSTILE_ACTION = "send_otp";

const TURNSTILE_ALERT_TTL_MS = 15 * 60 * 1000;
const turnstileAlertCache = new Map<string, number>();

function failOpenAlert(reason: string, detail?: Record<string, unknown>): void {
  const now = Date.now();
  const last = turnstileAlertCache.get(reason) ?? 0;
  if (now - last < TURNSTILE_ALERT_TTL_MS) return;
  turnstileAlertCache.set(reason, now);
  logger.error(`[otp] Turnstile degraded — failing open (${reason})`, detail);
}

export function resetTurnstileAlertCache(): void {
  turnstileAlertCache.clear();
}

async function verifyTurnstile(
  token: string,
  env: Env,
  clientIp: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    if (env.APP_ENV === "development") {
      return true;
    }
    return false;
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

    if (!res.ok) {
      failOpenAlert("siteverify_non_ok", { status: res.status });
      return true;
    }

    const result: {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    } = await res.json();

    if (result.success === false) {
      const codes = result["error-codes"] ?? [];
      if (codes.includes("invalid-input-response")) {
        return false;
      }
      failOpenAlert("validation_failed", { codes });
      return true;
    }

    if (result.action !== TURNSTILE_ACTION) return false;
    if (
      expectedHostnames.length > 0 &&
      !expectedHostnames.includes(result.hostname ?? "")
    ) {
      return false;
    }
    return true;
  } catch (e) {
    failOpenAlert("siteverify_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

async function throttled(
  env: Env,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (!env.THROTTLE_DO) return true;
  const failClosed = env.APP_ENV !== "development";
  try {
    const stub = env.THROTTLE_DO.getByName(
      "otp",
    ) as unknown as DurableObjectStub;
    const res: Response = await stub.fetch(
      `https://otp-throttle/allow?key=${encodeURIComponent(key)}&limit=${limit}&windowSec=${windowSec}`,
    );
    if (!res.ok) {
      if (failClosed) {
        logger.warn(`[otp] throttle check non-OK (${res.status}), denying`);
        return false;
      }
      return true;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      if (failClosed) {
        logger.warn(`[otp] throttle check returned malformed body, denying`, {
          error: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
      return true;
    }
    if (typeof body === "object" && body !== null && "allowed" in body) {
      return body.allowed === true;
    }
    if (failClosed) {
      logger.warn("[otp] throttle check returned unexpected shape, denying");
      return false;
    }
    return true;
  } catch (e) {
    logger.warn(
      failClosed
        ? "[otp] throttle check failed, denying request"
        : "[otp] throttle check failed, allowing request",
      { error: e instanceof Error ? e.message : String(e) },
    );
    return !failClosed;
  }
}

export async function handleSendOtp(
  request: Request,
  env: Env,
): Promise<Response> {
  const ctGuard = guardContentType(request);
  if (!ctGuard.allowed) return ctGuard.response;

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

  const headerAppCheck = request.headers.get("X-Firebase-AppCheck");
  const appToken = appCheckToken || headerAppCheck;

  if (appToken) {
    const verified = await verifyAppCheck(appToken, env);
    if (!verified) {
      return Response.json(
        { error: WORKER_ERROR_CODES.APP_CHECK_INVALID },
        { status: 403 },
      );
    }
  } else if (turnstileToken) {
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
    return Response.json(
      { error: WORKER_ERROR_CODES.APP_CHECK_REQUIRED },
      { status: 403 },
    );
  }

  if (!(await throttled(env, `ip:${clientIp}`, 20, 60))) {
    return tooManyRequests("Please wait a moment.", 60);
  }
  if (!(await throttled(env, `email:${email}`, 4, 600))) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  try {
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
      const status = res?.status ?? 0;
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
