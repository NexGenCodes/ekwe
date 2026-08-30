import { Env } from "../core/types";

/**
 * Service-role Supabase REST client.
 *
 * Every Supabase call in the worker sends the same three headers with the
 * service-role key. This owns that transport; call sites keep their own
 * response handling (the failure semantics differ per RPC: preflight fails
 * closed, usage fails soft, webhook refuses activation, etc.).
 */

/** Default timeout for Supabase requests (15s). Increased from 8s to handle
 *  webhook processing where the RPC needs to check/insert subscription rows,
 *  update the plan, and commit. 8s was too aggressive and caused spurious
 *  transient failures that blocked webhook retries. */
const SUPABASE_TIMEOUT_MS = 15_000;

/** Timeout for lightweight read-only queries (8s). */
const SUPABASE_READ_TIMEOUT_MS = 8_000;

/** Service-role headers, or null when the worker isn't configured. */
export function supabaseServiceHeaders(
  env: Env,
): Record<string, string> | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Headers for OTP sends that forward the end-user IP to Supabase Auth.
 *
 * Auth honors the `Sb-Forwarded-For` header for per-IP rate limiting ONLY when
 * the request is authenticated with a secret API key (`sb_secret_...`) — legacy
 * `anon`/`service_role` keys are not supported (see
 * supabase.com/docs/guides/auth/rate-limits#ip-address-forwarding). The feature
 * is enabled on the project via `security_sb_forwarded_for_enabled`.
 *
 * Opaque keys are not JWTs, so they go on the `apikey` header alone; putting
 * them on `Authorization: Bearer` makes the gateway reject the request as an
 * invalid JWT. The gateway translates the opaque key and synthesizes the
 * bearer JWT internally, so admin operations (`create_user`) keep working.
 *
 * Falls back to plain service-role headers (funneling through the worker's
 * egress IP) when no secret key is configured, so local dev without the key
 * and any misconfiguration keep the previous behavior.
 */
export function supabaseOtpHeaders(
  env: Env,
  clientIp: string,
): Record<string, string> | null {
  if (
    !env.SUPABASE_URL ||
    (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return null;
  }
  if (!env.SUPABASE_SECRET_KEY) return supabaseServiceHeaders(env);
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    "Sb-Forwarded-For": clientIp,
    "Content-Type": "application/json",
  };
}

/**
 * POST to a Supabase REST/auth path with service-role auth.
 *
 * Returns null when the worker isn't configured (no network attempt — callers
 * treat null as "unavailable"). Network/upstream errors propagate as rejects
 * so callers can log with their own context.
 *
 * @param timeoutMs Override the default timeout. Use the shorter read timeout
 *   for lightweight queries (preflight checks, usage reads) and the longer
 *   default for write-heavy operations (webhook processing).
 * @param headers Optional override for the auth headers. Callers that need a
 *   special credential (e.g. the OTP route, which uses the secret API key to
 *   forward the end-user IP) pass their own; otherwise service-role headers
 *   are used.
 */
export async function supabasePost(
  env: Env,
  path: string,
  body: unknown,
  timeoutMs: number = SUPABASE_TIMEOUT_MS,
  headers?: Record<string, string> | null,
): Promise<Response | null> {
  const authHeaders = headers ?? supabaseServiceHeaders(env);
  if (!authHeaders) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${env.SUPABASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET to a Supabase REST path with service-role auth.
 *
 * Returns null when the worker isn't configured (no network attempt). Network
 * failures propagate as rejects so callers can log with their own context.
 *
 * Uses the shorter read timeout since GETs are lightweight queries.
 */
export async function supabaseGet(
  env: Env,
  path: string,
): Promise<Response | null> {
  const headers = supabaseServiceHeaders(env);
  if (!headers) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_READ_TIMEOUT_MS);
  try {
    return await fetch(`${env.SUPABASE_URL}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
