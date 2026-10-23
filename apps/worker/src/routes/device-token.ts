import {
  WORKER_ERROR_CODES,
  registerPushTokenRequestSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import { describeError, retryTransient } from "@/db/retry";
import type { z } from "zod";

import { type AuthResult } from "@/core/auth";
import { logger } from "@/core/logger";

export async function handleRegisterDeviceToken(
  body: z.infer<typeof registerPushTokenRequestSchema>,
  env: Env,
  auth: AuthResult,
): Promise<Response> {
  const now = Date.now();

  try {
    await retryTransient(() =>
      env.DB.prepare(
        `INSERT INTO push_tokens
           (id, user_id, push_token, platform, app_version, is_active, last_used_at, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (push_token) DO UPDATE SET
           platform = excluded.platform,
           app_version = excluded.app_version,
           is_active = 1,
           last_used_at = excluded.last_used_at
         WHERE push_tokens.user_id = excluded.user_id`,
      )
        .bind(
          crypto.randomUUID(),
          auth.userId,
          body.push_token,
          body.platform,
          body.app_version ?? null,
          now,
          now,
        )
        .run(),
    );
  } catch (error) {
    logger.error("[device-token] failed to upsert push token", {
      error: describeError(error),
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVER_ERROR },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
