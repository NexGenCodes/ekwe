import {
  WORKER_ERROR_CODES,
  pushNotifyRequestSchema,
  updateManifestSchema,
} from "@ekwe/shared";
import { Env } from "@/core/types";
import type { z } from "zod";
import { withCache } from "@/core/cache";
import { logger } from "@/core/logger";
import { describeError, retryOnConnectionLoss } from "@/db/retry";
import { pushTokens } from "@ekwe/db/schema";
import { eq, inArray } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MANIFEST_KEY = "update:manifest";

interface ActiveTokenRow {
  push_token: string;
  platform: string;
  user_id: string | null;
}

interface ExpoPushMessage {
  to: string;
  priority: string;
  data: {
    type: string;
    version: string;
    downloadUrl: string;
    versionCode?: string;
    checksumSha256?: string;
  };
}

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

const EXPO_PUSH_BATCH_LIMIT = 100;

async function sendExpoBatch(
  batch: ExpoPushMessage[],
): Promise<{ tickets: ExpoTicket[]; error: string | null }> {
  try {
    const pushRes = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(batch),
    });

    if (!pushRes.ok) {
      return { tickets: [], error: `expo_push_${pushRes.status}` };
    }

    const result: { data?: ExpoTicket[] } = await pushRes.json();
    return { tickets: result.data ?? [], error: null };
  } catch (error) {
    return {
      tickets: [],
      error: error instanceof Error ? error.name : "expo_push_exception",
    };
  }
}

export async function handleUpdateNotify(
  body: z.infer<typeof pushNotifyRequestSchema>,
  env: Env,
): Promise<Response> {
  const versionCode = body.versionCode;
  const checksumSha256 = body.checksumSha256;

  let rows: ActiveTokenRow[];
  try {
    rows = await retryOnConnectionLoss(
      (client) =>
        client
          .select({
            push_token: pushTokens.pushToken,
            platform: pushTokens.platform,
            user_id: pushTokens.userId,
          })
          .from(pushTokens)
          .where(eq(pushTokens.isActive, true)),
      env,
    );
  } catch (err) {
    logger.error("[admin:update/notify] Failed to fetch active push tokens", {
      error: describeError(err),
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.SERVER_ERROR },
      { status: 502 },
    );
  }
  const androidTokens = rows
    .filter((r) => r.platform === "android")
    .map((r) => r.push_token);

  if (androidTokens.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  const version = body.version;

  const messages: ExpoPushMessage[] = androidTokens.map((token) => ({
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

  // Expo accepts at most 100 messages per request and rejects the whole body
  // beyond that, so an audience larger than one batch has to be split.
  const tickets: ExpoTicket[] = [];
  let batchFailure: string | null = null;
  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_LIMIT) {
    const result = await sendExpoBatch(
      messages.slice(i, i + EXPO_PUSH_BATCH_LIMIT),
    );
    tickets.push(...result.tickets);
    batchFailure ??= result.error;
  }

  if (androidTokens.length > 0 && tickets.length === 0 && batchFailure) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_SERVER_ERROR },
      { status: 502 },
    );
  }

  let deactivated = 0;
  let failed = 0;
  const failureReasons: string[] = [];
  const staleTokens: string[] = [];
  for (let i = 0; i < tickets.length && i < androidTokens.length; i++) {
    const ticket = tickets[i];
    if (ticket.status !== "error") continue;

    const reason = ticket.details?.error ?? "Unknown";
    if (reason === "DeviceNotRegistered") {
      staleTokens.push(androidTokens[i]);
    } else {
      failed += 1;
      if (failureReasons.length < 5) failureReasons.push(reason);
    }
  }

  // One statement rather than one call per token: a launch that invalidates
  // thousands of tokens would otherwise exceed the subrequest ceiling and
  // report a partial deactivation.
  if (staleTokens.length > 0) {
    try {
      await retryOnConnectionLoss(
        (client) =>
          client
            .update(pushTokens)
            .set({ isActive: false })
            .where(inArray(pushTokens.pushToken, staleTokens)),
        env,
      );
      deactivated = staleTokens.length;
    } catch (err) {
      logger.error("[admin:update/notify] Bulk deactivate failed", {
        error: describeError(err),
        count: staleTokens.length,
      });
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
  manifest: z.infer<typeof updateManifestSchema>,
  env: Env,
): Promise<Response> {
  await env.EKWE_KV.put(MANIFEST_KEY, JSON.stringify(manifest));
  return Response.json({ ok: true });
}
