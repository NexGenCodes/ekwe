import { WORKER_ERROR_CODES, registerPushTokenRequestSchema } from "@ekwe/shared";
import { Env } from "../core/types";
import { safeParseJSON } from "../core/guards";
import { supabasePost } from "../services/supabase";

/**
 * POST /push-tokens — register (or refresh) a device push token.
 *
 * Called at app launch (before sign-in), so there is no authenticated user yet:
 * the Worker upserts by token string. Tokens are opaque Expo tokens; the
 * `ExponentPushToken[...]` prefix check (enforced in the shared schema) is the
 * cheap abuse gate.
 */

export async function handleRegisterPushToken(
  request: Request,
  env: Env,
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