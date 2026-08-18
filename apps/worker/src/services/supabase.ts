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
 * POST to a Supabase REST/auth path with service-role auth.
 *
 * Returns null when the worker isn't configured (no network attempt — callers
 * treat null as "unavailable"). Network/upstream errors propagate as rejects
 * so callers can log with their own context.
 *
 * @param timeoutMs Override the default timeout. Use the shorter read timeout
 *   for lightweight queries (preflight checks, usage reads) and the longer
 *   default for write-heavy operations (webhook processing).
 */
export async function supabasePost(
  env: Env,
  path: string,
  body: unknown,
  timeoutMs: number = SUPABASE_TIMEOUT_MS,
): Promise<Response | null> {
  const headers = supabaseServiceHeaders(env);
  if (!headers) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${env.SUPABASE_URL}${path}`, {
      method: "POST",
      headers,
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
