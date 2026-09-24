import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { WORKER_ERROR_CODES, webhookEventSchema } from "@ekwe/shared";
import type { WebhookVerificationResult } from "@ekwe/shared";
import { readLimitedBody } from "@/core/guards";
import { hashKey, hexEncode, timingSafeEqual } from "@/utils/keys";
import { bytesToBase64 } from "@/utils/base64";
import { processWebhookEvent } from "@/services/billing";

const WEBHOOK_MAX_BYTES = 256 * 1024;
const IDEMPOTENCY_TTL = 86400;

async function computeHMAC(
  secret: string,
  payload: string,
  algorithm: "SHA-256" | "SHA-512",
  encoding: "hex" | "base64" = "hex",
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );

  if (encoding === "base64") {
    return bytesToBase64(new Uint8Array(signatureBuffer));
  }

  return hexEncode(signatureBuffer);
}

export async function verifyWebhook(
  request: Request,
  rawBody: string,
  env: {
    FLUTTERWAVE_WEBHOOK_SECRET?: string;
    [key: string]: unknown;
  },
): Promise<WebhookVerificationResult> {
  const headers = request.headers;

  const verifHash = headers.get("verif-hash");
  const flutterwaveSig = headers.get("flutterwave-signature");

  if (verifHash || flutterwaveSig) {
    if (!env.FLUTTERWAVE_WEBHOOK_SECRET) {
      logger.error("Missing FLUTTERWAVE_WEBHOOK_SECRET in environment");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Server misconfiguration",
        code: WORKER_ERROR_CODES.SERVER_ERROR,
      };
    }

    let isValid = false;

    if (verifHash) {
      isValid = await timingSafeEqual(
        verifHash,
        env.FLUTTERWAVE_WEBHOOK_SECRET,
      );
    }

    if (!isValid && flutterwaveSig) {
      const computed = await computeHMAC(
        env.FLUTTERWAVE_WEBHOOK_SECRET,
        rawBody,
        "SHA-256",
        "base64",
      );
      isValid = await timingSafeEqual(computed, flutterwaveSig);
    }

    if (!isValid) {
      logger.warn("[webhook] Flutterwave signature mismatch");
      return {
        isValid: false,
        provider: "flutterwave",
        error: "Signature mismatch",
        code: WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      };
    }
    return { isValid, provider: "flutterwave" };
  }

  logger.warn("[webhook] Request missing valid webhook signature headers");
  return {
    isValid: false,
    provider: "unknown",
    error: "Missing signature headers",
    code: WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
  };
}

type IdempotencyClaim = "ok" | "duplicate" | "error";

async function claimIdempotency(
  db: D1Database | undefined,
  key: string,
  expirationTtlSeconds = 86_400,
): Promise<IdempotencyClaim> {
  if (!db) {
    return "ok";
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const { meta } = await db
      .prepare(
        `INSERT INTO webhook_idempotency (idempotency_key, created_at, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(key, now, now + expirationTtlSeconds)
      .run();
    return (meta.changes ?? 0) > 0 ? "ok" : "duplicate";
  } catch (e) {
    logger.error("[idempotency] claim failed, failing closed (retryable)", {
      error: String(e),
    });
    return "error";
  }
}

async function releaseIdempotency(
  db: D1Database | undefined,
  key: string,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(`DELETE FROM webhook_idempotency WHERE idempotency_key = ?`)
      .bind(key)
      .run();
  } catch (e) {
    logger.error("[idempotency] release failed (best-effort)", {
      error: String(e),
    });
  }
}

function extractIdempotencyKey(event: Record<string, unknown>): string | null {
  const eventType =
    typeof event.event === "string" ? event.event.slice(0, 64) : "unknown";

  if (event.id && typeof event.id === "number") {
    return `webhook:fw:${eventType}:${event.id}`;
  }

  const data = event.data as Record<string, unknown> | undefined;
  if (data && data.id && typeof data.id === "number") {
    return `webhook:fw:${eventType}:${data.id}`;
  }

  return null;
}

export async function handleWebhook(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && parseInt(contentLength, 10) > WEBHOOK_MAX_BYTES) {
    logger.warn(`[webhook] Payload too large: ${contentLength} bytes`);
    return Response.json(
      { error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE },
      { status: 413 },
    );
  }

  let rawBody: string;
  try {
    const bytes = await readLimitedBody(request, WEBHOOK_MAX_BYTES);
    if (bytes === null) {
      logger.warn(
        `[webhook] Body exceeds size limit: ${WEBHOOK_MAX_BYTES} bytes`,
      );
      return Response.json(
        { error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE },
        { status: 413 },
      );
    }
    rawBody = new TextDecoder().decode(bytes);
  } catch (err) {
    logger.warn("[webhook] Failed to read body", { error: String(err) });
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const verification = await verifyWebhook(request, rawBody, env);

  if (!verification.isValid) {
    logger.warn(
      `[webhook] Rejected: provider=${verification.provider}, error=${verification.error || "signature mismatch"}`,
    );
    return Response.json(
      {
        error:
          verification.code ?? WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
        message: "Webhook signature verification failed.",
      },
      { status: 401 },
    );
  }

  logger.info(`[webhook] Verified: provider=${verification.provider}`);

  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(rawBody);
  } catch {
    logger.warn("[webhook] Valid signature but malformed JSON body", {
      provider: verification.provider,
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  const parsedEvent = webhookEventSchema.safeParse(rawEvent);
  if (!parsedEvent.success) {
    logger.warn("[webhook] Valid signature but unexpected event shape", {
      provider: verification.provider,
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }
  const event: Record<string, unknown> = parsedEvent.data;

  const idempotencyKey =
    extractIdempotencyKey(event) ?? `webhook:hash:${await hashKey(rawBody)}`;

  const claimed = await claimIdempotency(
    env.EKWE_D1,
    idempotencyKey,
    IDEMPOTENCY_TTL,
  );
  if (claimed === "duplicate") {
    logger.info(
      `[webhook] Duplicate event detected (key: ${idempotencyKey.slice(0, 32)})`,
    );
    return Response.json({ received: true, action: "duplicate" });
  }
  if (claimed === "error") {
    logger.error(
      `[webhook] Idempotency claim failed; not processing (key: ${idempotencyKey.slice(0, 32)})`,
    );
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SERVER_ERROR,
        message: "Failed to claim webhook event; retryable",
      },
      { status: 500 },
    );
  }

  const { response, fullyApplied } = await processWebhookEvent(
    verification.provider,
    event,
    env,
  );

  if (!fullyApplied) {
    await releaseIdempotency(env.EKWE_D1, idempotencyKey);
    logger.warn(
      "[webhook] Event not fully applied; returning 500 so the provider retries",
    );
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SERVER_ERROR,
        message: "Failed to sync subscription state; retryable",
      },
      { status: 500 },
    );
  }

  return response;
}
