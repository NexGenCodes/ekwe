import { jwtVerify, createRemoteJWKSet } from "jose";
import { logger } from "@/core/logger";
import { Env, Tier, JWTPayloadWithMeta } from "@/core/types";
import { timingSafeEqual } from "@/utils/keys";

const jwksFetchers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(env: Env): ReturnType<typeof createRemoteJWKSet> {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let fetcher = jwksFetchers.get(url);
  if (!fetcher) {
    fetcher = createRemoteJWKSet(new URL(url));
    jwksFetchers.set(url, fetcher);
  }
  return fetcher;
}

export interface AuthResult {
  userId: string;
  userEmail: string;
  tier: Tier;
  sessionId: string | null;
}

function extractAuthResult(payload: JWTPayloadWithMeta): AuthResult | null {
  if (!payload.sub) return null;
  return {
    userId: payload.sub,
    userEmail: payload.email || "",
    tier: payload.app_metadata?.is_pro ? "PREMIUM" : "FREE",
    sessionId: payload.session_id ?? null,
  };
}

export async function authenticate(
  token: string,
  env: Env,
): Promise<AuthResult | null> {
  try {
    const { payload } = await jwtVerify(token, getJWKS(env), {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });
    return extractAuthResult(payload);
  } catch (err) {
    logger.warn("[auth] JWT verification failed", { error: String(err) });
    return null;
  }
}

function getUpdateNotifySecret(env: Env): string | undefined {
  const value = env.UPDATE_NOTIFY_SECRET;
  return typeof value === "string" ? value : undefined;
}

export async function isAdminAuthorized(
  env: Env,
  request: Request,
): Promise<boolean> {
  const secret = getUpdateNotifySecret(env);
  if (!secret) return false;
  const auth = request.headers.get("Authorization");
  if (auth === null) return false;
  return timingSafeEqual(auth, `Bearer ${secret}`);
}
