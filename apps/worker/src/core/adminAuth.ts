import type { Env } from "@/core/types";
import { timingSafeEqual } from "@/utils/keys";
import { getAdminEmails } from "@/auth/users";

async function hasAdminRoleByEmail(env: Env, email: string): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT role FROM users WHERE email_norm = ? LIMIT 1`,
    )
      .bind(email.toLowerCase())
      .first<{ role: string }>();
    return row?.role === "admin";
  } catch {
    return false;
  }
}

export async function verifyAdmin(
  env: Env,
  request: Request,
): Promise<{ ok: boolean; email: string | null }> {
  const isDev = env.APP_ENV !== "production";

  const secret = env.UPDATE_NOTIFY_SECRET as string | undefined;
  const authHeader = request.headers.get("Authorization");
  if (isDev && secret && authHeader) {
    const ok = await timingSafeEqual(authHeader, `Bearer ${secret}`);
    if (ok) return { ok: true, email: "dev@local" };
  }

  const issuer = env.CF_ACCESS_ISSUER;
  const audience = env.CF_ACCESS_AUDIENCE;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!issuer || !audience || !jwt) {
    return { ok: false, email: null };
  }

  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(
      new URL(`${issuer.replace(/\/$/, "")}/cdn-cgi/access/certs`),
    );
    const { payload } = await jwtVerify(jwt, jwks, { issuer, audience });
    const email =
      typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return { ok: false, email: null };
    if (getAdminEmails(env).includes(email)) return { ok: true, email };
    if (await hasAdminRoleByEmail(env, email)) return { ok: true, email };
    return { ok: false, email: null };
  } catch {
    return { ok: false, email: null };
  }
}
