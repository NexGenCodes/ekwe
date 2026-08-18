import { jwtVerify, createRemoteJWKSet } from "jose";
import { logger } from "./logger";
import { Env, Tier, JWTPayloadWithMeta } from "./types";

let JWKS: ReturnType<typeof createRemoteJWKSet>;
let JWKS_TS = 0;
const JWKS_TTL = 3_600_000;

function getJWKS(
  env: Env,
  force = false,
): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now();
  if (!JWKS || force || now - JWKS_TS > JWKS_TTL) {
    JWKS = createRemoteJWKSet(
      new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
    );
    JWKS_TS = now;
  }
  return JWKS;
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
 * Retries once with a fresh JWKS on verification failure (key rotation).
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
  } catch {
    try {
      const { payload } = await jwtVerify(token, getJWKS(env, true), {
        issuer: `${env.SUPABASE_URL}/auth/v1`,
        audience: "authenticated",
      });
      return extractAuthResult(payload);
    } catch {
      logger.warn("[auth] JWT verification failed after JWKS refresh");
      return null;
    }
  }
}
