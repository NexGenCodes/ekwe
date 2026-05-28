import { jwtVerify, createRemoteJWKSet } from 'jose';

import { Env, Tier, JWTPayloadWithMeta } from './types';

let JWKS: ReturnType<typeof createRemoteJWKSet>;
let JWKS_TS = 0;
const JWKS_TTL = 3_600_000;

export function getJWKS(
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
      audience: 'authenticated',
    });
    const meta = payload as JWTPayloadWithMeta;
    if (!meta.sub) return null;
    return {
      userId: meta.sub,
      userEmail: meta.email || '',
      tier: meta.app_metadata?.is_pro ? 'PREMIUM' : 'FREE',
    };
  } catch {
    try {
      const { payload } = await jwtVerify(token, getJWKS(env, true), {
        issuer: `${env.SUPABASE_URL}/auth/v1`,
        audience: 'authenticated',
      });
      const meta = payload as JWTPayloadWithMeta;
      if (!meta.sub) return null;
      return {
        userId: meta.sub,
        userEmail: meta.email || '',
        tier: meta.app_metadata?.is_pro ? 'PREMIUM' : 'FREE',
      };
    } catch {
      return null;
    }
  }
}
