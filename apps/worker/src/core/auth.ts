import type { Env, Tier } from "@/core/types";
import { verifyAccessToken } from "@/auth/jwt";
import { timingSafeEqual } from "@/utils/keys";

export interface AuthResult {
  userId: string;
  userEmail: string;
  tier: Tier;
  sessionId: string | null;
}

export async function authenticate(
  token: string,
  env: Env,
): Promise<AuthResult | null> {
  const claims = await verifyAccessToken(env, token);
  if (!claims) return null;

  if (env.EKWE_KV) {
    try {
      const [revoked, disabled] = await Promise.all([
        claims.sessionId
          ? env.EKWE_KV.get(`revoked:session:${claims.sessionId}`)
          : Promise.resolve(null),
        env.EKWE_KV.get(`disabled:user:${claims.userId}`),
      ]);
      if (revoked !== null || disabled !== null) return null;
    } catch {
      // Best-effort KV checks; fail open on KV transient error.
    }
  }

  return {
    userId: claims.userId,
    userEmail: claims.email,
    tier: claims.isPro ? "PREMIUM" : "FREE",
    sessionId: claims.sessionId || null,
  };
}

export async function isAdminAuthorized(
  env: Env,
  request: Request,
): Promise<boolean> {
  const secret = env.UPDATE_NOTIFY_SECRET;
  if (!secret) return false;

  const authorization = request.headers.get("Authorization");
  if (authorization === null) return false;

  return timingSafeEqual(authorization, `Bearer ${secret}`);
}
