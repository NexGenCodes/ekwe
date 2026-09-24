import { Env } from "@/core/types";

const SUPABASE_TIMEOUT_MS = 15_000;

const SUPABASE_READ_TIMEOUT_MS = 8_000;

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
