import type { Env } from "@/core/types";
import { timingSafeEqual } from "@/utils/keys";

/**
 * Dashboard admin auth (browser), distinct from isAdminAuthorized (CI release).
 * Production: Cloudflare Access JWT (Cf-Access-Jwt-Assertion) verified against
 *   the tenant JWKS, email must be in ADMIN_EMAILS.
 * Dev (APP_ENV != production) + Bearer UPDATE_NOTIFY_SECRET: allowed for
 *   curl / local testing without a Cloudflare tenant.
 */
export function getAdminEmails(env: Env): string[] {
  const raw = env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function verifyAdmin(
  env: Env,
  request: Request,
): Promise<{ ok: boolean; email: string | null }> {
  const emails = getAdminEmails(env);
  const isDev = env.APP_ENV !== "production";

  // Dev/CI fallback: same shared secret as release admin.
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
    // No Access configured: deny in production, deny in dev (require secret above).
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
    if (!email || !emails.includes(email)) return { ok: false, email: null };
    return { ok: true, email };
  } catch {
    return { ok: false, email: null };
  }
}
