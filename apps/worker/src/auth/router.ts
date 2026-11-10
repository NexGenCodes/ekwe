import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "@/app";
import {
  WORKER_ERROR_CODES,
  appleAuthRequestSchema,
  googleAuthRequestSchema,
  normalizeEmail,
  otpRequestSchema,
  otpVerifyRequestSchema,
  profileUpdateSchema,
  refreshRequestSchema,
} from "@ekwe/shared";
import { error } from "@/core/http";
import { readJson } from "@/core/validate";
import { tooManyRequests } from "@/core/guards";
import { authMiddleware } from "@/middleware";
import { mintAccessToken } from "@/auth/jwt";
import { allowRequest, checkBot, clientIp } from "@/auth/guards";
import { consumeOtp, sendOtp } from "@/auth/otp";
import { verifyApple, verifyGoogle } from "@/auth/providers";
import { createSession, revokeSession, rotateSession } from "@/auth/sessions";
import {
  deleteAccount,
  findOrCreateUser,
  findUserById,
  findUserByIdentity,
  isAccountDisabled,
  isPremiumWithAdmin,
  toPayload,
  updateProfile,
  type UserRow,
} from "@/auth/users";
import type { Env } from "@/core/types";

export const authRouter = new Hono<AppEnv>();

authRouter.use(
  "*",
  bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) =>
      c.json({ error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE }, 413),
  }),
);

interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: number;
}

async function tokenResponse(
  env: Env,
  user: UserRow,
  session: IssuedSession,
): Promise<Response> {
  const isPro = await isPremiumWithAdmin(env, user);
  const { token, expiresAt } = await mintAccessToken(env, {
    userId: user.id,
    email: user.email,
    sessionId: session.sessionId,
    isPro,
  });

  return Response.json({
    user: await toPayload(env, user),
    accessToken: token,
    expiresAt,
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.refreshExpiresAt,
  });
}

function disabledAccountResponse(): Response {
  return error(
    WORKER_ERROR_CODES.ACCOUNT_DISABLED,
    403,
    "This account has been disabled. Contact support if you think this is a mistake.",
  );
}

async function startSession(
  env: Env,
  user: UserRow,
  userAgent: string | null,
): Promise<Response> {
  if (isAccountDisabled(user)) return disabledAccountResponse();
  const session = await createSession(env, user.id, userAgent);
  return tokenResponse(env, user, session);
}

authRouter.post("/otp", async (c) => {
  const body = await readJson(c, otpRequestSchema);
  if (body instanceof Response) return body;

  const bot = await checkBot(c.req.raw, c.env, body);
  if (!bot.ok) return error(bot.code, bot.status);

  const ip = clientIp(c.req.raw);
  if (!(await allowRequest(c.env, `otp:ip:${ip}`, 20, 60))) {
    return tooManyRequests("Please wait a moment.", 60);
  }
  if (
    !(await allowRequest(
      c.env,
      `otp:email:${normalizeEmail(body.email)}`,
      4,
      600,
    ))
  ) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  const result = await sendOtp(c.env, body.email);
  if (result.ok) return c.json({ ok: true });

  if (result.reason === "cooldown") {
    return tooManyRequests(
      "Please wait before requesting another code.",
      result.retryAfter,
    );
  }

  return error(WORKER_ERROR_CODES.OTP_SEND_FAILED, 502);
});

authRouter.post("/verify", async (c) => {
  const body = await readJson(c, otpVerifyRequestSchema);
  if (body instanceof Response) return body;

  const ip = clientIp(c.req.raw);
  if (!(await allowRequest(c.env, `verify:ip:${ip}`, 30, 600))) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  const result = await consumeOtp(c.env, body.email, body.code);
  if (!result.ok) {
    if (result.reason === "locked") {
      return tooManyRequests("Too many attempts. Request a new code.", 300);
    }
    return error("INVALID_CODE", 400, "That code is not valid.");
  }

  const user = await findOrCreateUser(c.env, {
    email: body.email,
    provider: "email",
    providerUserId: normalizeEmail(body.email),
  });
  if (isAccountDisabled(user)) return disabledAccountResponse();

  return startSession(c.env, user, c.req.header("User-Agent") ?? null);
});

authRouter.post("/refresh", async (c) => {
  const body = await readJson(c, refreshRequestSchema);
  if (body instanceof Response) return body;

  const rotated = await rotateSession(c.env, body.refreshToken);
  if (!rotated.ok) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);

  const user = await findUserById(c.env, rotated.userId);
  if (!user) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);
  if (isAccountDisabled(user)) return disabledAccountResponse();

  return tokenResponse(c.env, user, rotated);
});

async function providerSignIn(
  c: Context<AppEnv>,
  provider: "apple" | "google",
  profile: {
    providerUserId: string;
    email: string | null;
    displayName: string | null;
    emailVerified: boolean;
  },
): Promise<Response> {
  if (profile.email && !profile.emailVerified) {
    return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);
  }

  const user = profile.email
    ? await findOrCreateUser(c.env, {
        email: profile.email,
        provider,
        providerUserId: profile.providerUserId,
        displayName: profile.displayName,
      })
    : await findUserByIdentity(c.env, provider, profile.providerUserId);

  if (!user) {
    return error(
      WORKER_ERROR_CODES.UNAUTHORIZED,
      401,
      "No account is linked to this sign-in.",
    );
  }
  if (isAccountDisabled(user)) return disabledAccountResponse();

  return startSession(c.env, user, c.req.header("User-Agent") ?? null);
}

authRouter.post("/apple", async (c) => {
  const body = await readJson(c, appleAuthRequestSchema);
  if (body instanceof Response) return body;

  if (
    !(await allowRequest(c.env, `oauth:ip:${clientIp(c.req.raw)}`, 20, 600))
  ) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  const profile = await verifyApple(c.env, body.identityToken, body.nonce);
  if (!profile) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);

  return providerSignIn(c, "apple", {
    ...profile,
    displayName: body.fullName ?? profile.displayName,
  });
});

authRouter.post("/google", async (c) => {
  const body = await readJson(c, googleAuthRequestSchema);
  if (body instanceof Response) return body;

  if (
    !(await allowRequest(c.env, `oauth:ip:${clientIp(c.req.raw)}`, 20, 600))
  ) {
    return tooManyRequests("Please wait a few minutes.", 600);
  }

  const profile = await verifyGoogle(c.env, body.idToken);
  if (!profile) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);

  return providerSignIn(c, "google", profile);
});

authRouter.get("/session", authMiddleware(), async (c) => {
  const auth = c.get("auth")!;
  const user = await findUserById(c.env, auth.userId);
  if (!user) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);
  if (isAccountDisabled(user)) return disabledAccountResponse();

  return c.json({
    user: await toPayload(c.env, user),
  });
});

authRouter.patch("/profile", authMiddleware(), async (c) => {
  const body = await readJson(c, profileUpdateSchema);
  if (body instanceof Response) return body;

  const auth = c.get("auth")!;
  const existing = await findUserById(c.env, auth.userId);
  if (!existing) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);
  if (isAccountDisabled(existing)) return disabledAccountResponse();
  const user = await updateProfile(c.env, auth.userId, body);
  if (!user) return error(WORKER_ERROR_CODES.UNAUTHORIZED, 401);

  return c.json({
    user: await toPayload(c.env, user),
  });
});

authRouter.post("/logout", authMiddleware(), async (c) => {
  const auth = c.get("auth")!;
  if (auth.sessionId) await revokeSession(c.env, auth.sessionId);
  return c.json({ ok: true });
});

authRouter.delete("/account", authMiddleware(), async (c) => {
  const auth = c.get("auth")!;
  await deleteAccount(c.env, auth.userId);
  return c.body(null, 204);
});
