import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env } from "../core/types";
import { safeParseJSON } from "../core/guards";
import { supabasePost } from "../services/supabase";

/**
 * POST /push-tokens — register (or refresh) a device push token.
 *
 * Called at app launch (before sign-in), so there is no authenticated user yet:
 * the Worker upserts by token string. Tokens are opaque Expo tokens; the
 * `ExponentPushToken[...]` prefix check is the cheap abuse gate.
 */
interface RegisterPushTokenBody {
  push_token: string;
  platform: string;
  app_version?: string;
}

export async function handleRegisterPushToken(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data as Partial<RegisterPushTokenBody> | null;
  if (
    !body ||
    typeof body.push_token !== "string" ||
    !body.push_token.startsWith("ExponentPushToken[") ||
    (body.platform !== "android" && body.platform !== "ios")
  ) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const res = await supabasePost(env, "/rest/v1/rpc/upsert_push_token", {
    p_push_token: body.push_token,
    p_platform: body.platform,
    p_app_version: typeof body.app_version === "string" ? body.app_version : null,
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