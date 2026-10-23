import { SignJWT, importJWK, jwtVerify, type JWK } from "jose";
import type { Env } from "@/core/types";
import { ACCESS_TOKEN_TTL_SECONDS } from "@ekwe/shared";

export interface AccessClaims {
  userId: string;
  email: string;
  sessionId: string;
  isPro: boolean;
}

const ALGORITHM = "EdDSA";
const AUDIENCE = "authenticated";

const keyCache = new Map<string, CryptoKey>();

async function importSigningKey(jwk: string): Promise<CryptoKey> {
  const cached = keyCache.get(jwk);
  if (cached) return cached;

  const parsed = JSON.parse(jwk) as JWK;
  const key = (await importJWK(parsed, ALGORITHM)) as CryptoKey;
  keyCache.set(jwk, key);
  return key;
}

export async function mintAccessToken(
  env: Env,
  claims: AccessClaims,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ACCESS_TOKEN_TTL_SECONDS;

  const token = await new SignJWT({
    email: claims.email,
    session_id: claims.sessionId,
    app_metadata: { is_pro: claims.isPro },
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT", kid: "ekwe-1" })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(await importSigningKey(env.JWT_PRIVATE_JWK));

  return { token, expiresAt: expiresAt * 1000 };
}

export async function verifyAccessToken(
  env: Env,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      await importSigningKey(env.JWT_PUBLIC_JWK),
      { issuer: env.JWT_ISSUER, audience: AUDIENCE, algorithms: [ALGORITHM] },
    );

    if (!payload.sub || typeof payload.email !== "string") return null;

    return {
      userId: payload.sub,
      email: payload.email,
      sessionId:
        typeof payload.session_id === "string" ? payload.session_id : "",
      isPro:
        (payload.app_metadata as { is_pro?: boolean } | undefined)?.is_pro ===
        true,
    };
  } catch {
    return null;
  }
}

export function publicJwks(env: Env): { keys: JWK[] } {
  if (!env.JWT_PUBLIC_JWK) return { keys: [] };

  try {
    const jwk = JSON.parse(env.JWT_PUBLIC_JWK) as JWK;
    return { keys: [{ ...jwk, kid: "ekwe-1", alg: ALGORITHM, use: "sig" }] };
  } catch {
    return { keys: [] };
  }
}
