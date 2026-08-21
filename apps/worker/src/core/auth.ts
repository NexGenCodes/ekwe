import { jwtVerify, createRemoteJWKSet } from "jose";
import { logger } from "./logger";
import { Env, Tier, JWTPayloadWithMeta } from "./types";

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
  /** Supabase session UUID from the JWT's `session_id` claim, or null. */
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

/**
 * Verifies a Supabase JWT and returns the user's ID, email, and tier.
 * `createRemoteJWKSet` natively handles key rotation by re-fetching if a `kid` is missing.
 */
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
