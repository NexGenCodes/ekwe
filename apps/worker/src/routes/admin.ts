import {
  WORKER_ERROR_CODES,
  pushNotifyRequestSchema,
  updateManifestSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import { safeParseJSON } from "@/core/guards";
import { withCache } from "@/core/cache";
import { logger } from "@/core/logger";
import { supabasePost } from "@/services/supabase";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MANIFEST_KEY = "update:manifest";

interface ActiveTokenRow {
  push_token: string;
  platform: string;
  user_id: string | null;
}

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

export async function handleUpdateNotify(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const bodyResult = pushNotifyRequestSchema.safeParse(parsed.data);
  if (!bodyResult.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }
  const body = bodyResult.data;
  const versionCode = body.versionCode;
  const checksumSha256 = body.checksumSha256;

  const tokensRes = await supabasePost(
    env,
    "/rest/v1/rpc/get_active_push_tokens",
    "{}",
  );
  if (!tokensRes) {
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVICE_UNAVAILABLE },
      { status: 503 },
    );
  }
  if (!tokensRes.ok) {
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVER_ERROR },
      { status: 502 },
    );
  }

  const rows: ActiveTokenRow[] = await tokensRes.json();
  const androidTokens = rows
    .filter((r) => r.platform === "android")
    .map((r) => r.push_token);

  if (androidTokens.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const version = body.version;

  const payload = androidTokens.map((token) => ({
    to: token,
    priority: "high",
    data: {
      type: "apk_update",
      version,
      downloadUrl: body.downloadUrl,
      ...(versionCode !== undefined && { versionCode: String(versionCode) }),
      ...(checksumSha256 !== undefined && { checksumSha256 }),
    },
  }));

  const pushRes = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!pushRes.ok) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_SERVER_ERROR },
      { status: 502 },
    );
  }

  const result: { data?: ExpoTicket[] } = await pushRes.json();
  const tickets = result.data ?? [];

  let deactivated = 0;
  let failed = 0;
  const failureReasons: string[] = [];
  for (let i = 0; i < tickets.length && i < androidTokens.length; i++) {
    const ticket = tickets[i];
    if (ticket.status !== "error") continue;

    const reason = ticket.details?.error ?? "Unknown";
    if (reason === "DeviceNotRegistered") {
      const token = androidTokens[i];
      try {
        await supabasePost(env, "/rest/v1/rpc/deactivate_push_token", {
          p_push_token: token,
        });
        deactivated += 1;
      } catch {
        // best-effort cleanup
      }
    } else {
      failed += 1;
      if (failureReasons.length < 5) failureReasons.push(reason);
    }
  }

  if (failed > 0) {
    logger.error(
      `[admin:update/notify] ${failed}/${tickets.length} Expo push ticket(s) failed`,
      { failures: failureReasons, sent: androidTokens.length },
    );
  } else {
    logger.info(`[admin:update/notify] sent`, {
      sent: androidTokens.length,
      deactivated,
    });
  }

  return Response.json({
    ok: true,
    sent: androidTokens.length,
    deactivated,
    errors: failed,
  });
}

export async function handleGetUpdateManifest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(
    request,
    ctx,
    async () => {
      const raw = await env.EKWE_KV.get(MANIFEST_KEY);
      if (!raw) {
        return Response.json(
          { error: WORKER_ERROR_CODES.NOT_FOUND },
          { status: 404 },
        );
      }
      return new Response(raw, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
    },
    300,
  );
}

export async function handlePostUpdateManifest(
  request: Request,
  env: Env,
): Promise<Response> {
  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const manifest = updateManifestSchema.safeParse(parsed.data);
  if (!manifest.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  await env.EKWE_KV.put(MANIFEST_KEY, JSON.stringify(manifest.data));
  return Response.json({ ok: true });
}
