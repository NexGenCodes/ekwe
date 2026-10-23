import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { sha256 } from "@/auth/tokens";
import { timingSafeEqual } from "@/utils/keys";

export interface ProviderProfile {
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const appleJwks = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

export async function verifyApple(
  env: Env,
  identityToken: string,
  rawNonce: string,
): Promise<ProviderProfile | null> {
  const allowedAudiences = String(env.APPLE_BUNDLE_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowedAudiences.length === 0) return null;

  try {
    const { payload } = await jwtVerify(identityToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: allowedAudiences,
    });

    const tokenNonce = typeof payload.nonce === "string" ? payload.nonce : "";
    const expectedNonce = await sha256(rawNonce);
    if (!tokenNonce || !(await timingSafeEqual(tokenNonce, expectedNonce))) {
      return null;
    }

    if (!payload.sub) return null;

    return {
      providerUserId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      displayName: null,
      emailVerified:
        payload.email_verified === true || payload.email_verified === "true",
    };
  } catch {
    return null;
  }
}

export async function verifyGoogle(
  env: Env,
  idToken: string,
): Promise<ProviderProfile | null> {
  const allowedClients = (env.GOOGLE_CLIENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowedClients.length === 0) return null;

  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience: allowedClients,
    });

    // Android tokens carry the Android OAuth client in `azp` while `aud` is the
    // web client, so the pinned audience above is the authoritative check.
    if (!payload.sub || typeof payload.email !== "string") {
      logger.warn("[google] token is missing sub or email");
      return null;
    }
    if (payload.email_verified !== true && payload.email_verified !== "true") {
      logger.warn("[google] email is not verified");
      return null;
    }

    return {
      providerUserId: payload.sub,
      email: payload.email,
      displayName: typeof payload.name === "string" ? payload.name : null,
      emailVerified: true,
    };
  } catch (error) {
    logger.warn("[google] token verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
