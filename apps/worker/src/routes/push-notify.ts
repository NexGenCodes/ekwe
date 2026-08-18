import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env } from "../core/types";
import { safeParseJSON } from "../core/guards";
import { supabasePost } from "../services/supabase";

/**
 * POST /push-notify — send an APK update push to every active Android device.
 *
 * Authenticated with a shared secret (Authorization: Bearer PUSH_NOTIFY_SECRET),
 * called by the GitHub Actions release workflow. Sends a *data-only* Expo push
 * that the native FirebaseMessagingService interprets: it decides per-device
 * whether to show the update notification (never bothers users already on the
 * incoming version) and downloads + installs without opening the app.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushNotifyBody {
  version: string;
  downloadUrl: string;
  versionCode?: number;
  checksumSha256?: string;
}

interface ActiveTokenRow {
  push_token: string;
  platform: string;
}

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

function bearerSecret(env: Env): string | undefined {
  const value = env.PUSH_NOTIFY_SECRET;
  return typeof value === "string" ? value : undefined;
}

export async function handlePushNotify(
  request: Request,
  env: Env,
): Promise<Response> {
  const secret = bearerSecret(env);
  const auth = request.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json(
      { error: WORKER_ERROR_CODES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data as Partial<PushNotifyBody> | null;
  if (
    !body ||
    typeof body.version !== "string" ||
    !body.version.trim() ||
    typeof body.downloadUrl !== "string" ||
    !body.downloadUrl.startsWith("https://")
  ) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const versionCode = body.versionCode;
  const checksumSha256 = body.checksumSha256;

  if (
    versionCode !== undefined &&
    (!Number.isInteger(versionCode) || versionCode <= 0)
  ) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }
  if (
    checksumSha256 !== undefined &&
    !/^[0-9a-fA-F]{64}$/.test(checksumSha256)
  ) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

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

  const version = body.version.trim();

  // Expo push `data` values must be strings; forward the fields the native
  // service uses for gating (versionCode) and integrity (checksumSha256).
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

  // Expo reports dead tokens per message; prune them so future pushes stay lean.
  let deactivated = 0;
  for (let i = 0; i < tickets.length && i < androidTokens.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = androidTokens[i];
      try {
        await supabasePost(env, "/rest/v1/rpc/deactivate_push_token", {
          p_push_token: token,
        });
        deactivated += 1;
      } catch {
        // best-effort cleanup
      }
    }
  }

  return Response.json({ ok: true, sent: androidTokens.length, deactivated });
}