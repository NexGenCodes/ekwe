import {
  WORKER_ERROR_CODES,
  registerPushTokenRequestSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import { safeParseJSON } from "@/core/guards";
import { supabasePost } from "@/services/supabase";

import { type AuthResult } from "@/core/auth";

export async function handleRegisterDeviceToken(
  request: Request,
  env: Env,
  auth: AuthResult | null,
): Promise<Response> {
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = registerPushTokenRequestSchema.safeParse(parsed.data);
  if (!body.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const res = await supabasePost(env, "/rest/v1/rpc/upsert_push_token", {
    p_push_token: body.data.push_token,
    p_platform: body.data.platform,
    p_app_version: body.data.app_version ?? null,
    ...(auth?.userId ? { p_user_id: auth.userId } : {}),
  });

  if (!res) {
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE },
      { status: 503 },
    );
  }
  if (!res.ok) {
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVER_ERROR },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
