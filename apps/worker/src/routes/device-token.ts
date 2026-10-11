import {
  WORKER_ERROR_CODES,
  registerPushTokenRequestSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { pushTokens } from "@ekwe/db/schema";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import { type AuthResult } from "@/core/auth";
import { logger } from "@/core/logger";

export async function handleRegisterDeviceToken(
  body: z.infer<typeof registerPushTokenRequestSchema>,
  env: Env,
  auth: AuthResult | null,
): Promise<Response> {
  const values = {
    pushToken: body.push_token,
    platform: body.platform,
    appVersion: body.app_version ?? null,
    userId: auth?.userId ?? null,
  };

  try {
    await retryOnConnectionLoss(
      (client) =>
        client
          .insert(pushTokens)
          .values(values)
          .onConflictDoUpdate({
            target: pushTokens.pushToken,
            set: {
              platform: values.platform,
              appVersion: values.appVersion,
              isActive: true,
              lastUsedAt: sql`now()`,
              // Keeps the recorded owner, so a token can only be claimed while
              // unowned: no auth header cannot detach it, and another account
              // cannot re-point it. Anonymous registration still works.
              userId: sql`COALESCE(${pushTokens.userId}, ${values.userId}::uuid)`,
            },
          }),
      env,
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
