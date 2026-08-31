/**
 * ─── Webhook Router ──────────────────────────────────────────────
 *
 * Entry point for all payment provider webhooks. Verifies the signature,
 * identifies the provider, delegates to the registered processor, and
 * manages idempotency via Cloudflare KV.
 *
 * Idempotency strategy:
 *   - Flutterwave: Use event.id (transaction ID) as the idempotency key.
 *   - Fall back to body hash only when no stable ID is available.
 *
 * The idempotency key is stored in KV only AFTER the event is fully applied
 * (including the Supabase set_pro_status call). If the status change fails,
 * the key is skipped so a re-delivery can retry.
 */

import { Env } from "../core/types";
import { logger } from "../core/logger";
import { verifyWebhook } from "../services/signatures";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { readLimitedBody } from "../core/guards";
import { hashKey } from "../utils/keys";
import { processWebhookEvent } from "../services/billing";
import { claimIdempotency, releaseIdempotency } from "../services/idempotency";

const WEBHOOK_MAX_BYTES = 256 * 1024; // 256KB
const IDEMPOTENCY_TTL = 86400; // 24 hours

// ─── Idempotency Key Extraction ──────────────────────────────────
// Extract a stable, unique identifier from the event for idempotency.
// Falls back to body hash when no provider-specific ID is available.

function extractIdempotencyKey(
  event: Record<string, unknown>,
  bodyHash: string,
): string {
  // Flutterwave: event.id is the transaction ID (unique per event)
  if (event.id && typeof event.id === "number") {
    return `webhook:fw:${event.id}`;
  }

  // Unknown provider: fall back to body hash
  return `webhook:hash:${bodyHash}`;
}

// ─── Main Handler ────────────────────────────────────────────────

export async function handleWebhook(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  // Max size guard
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

  // Compute body hash for fallback idempotency (still needed for unknown providers)
  const bodyHash = await hashKey(rawBody);

  // ── Signature Verification ──
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

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn("[webhook] Valid signature but malformed JSON body", {
      provider: verification.provider,
    });
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_JSON },
      { status: 400 },
    );
  }

  // ── Idempotency Claim ──
  // Use the provider-specific event ID when available (prevents double-processing
  // of the same event even if the JSON serialization differs). Falls back to body
  // hash for unknown providers.
  //
  // Claiming is ATOMIC via a D1 INSERT ... ON CONFLICT DO NOTHING: of several
  // concurrent duplicate deliveries, exactly one wins the insert and processes;
  // the rest see `changes === 0` and are dropped. If processing fails to apply
  // fully, the claim is released so the provider's re-delivery can reclaim and
  // retry rather than being permanently deduped.
  const idempotencyKey = extractIdempotencyKey(event, bodyHash);

  const claimed = await claimIdempotency(
    env.EKWE_D1,
    idempotencyKey,
    IDEMPOTENCY_TTL,
  );
  if (!claimed) {
    logger.info(
      `[webhook] Duplicate event detected (key: ${idempotencyKey.slice(0, 32)})`,
    );
    return Response.json({ received: true, action: "duplicate" });
  }

  // ── Process Event ──
  const { response, fullyApplied } = await processWebhookEvent(
    verification.provider,
    event,
    env,
  );

  // A webhook that required a Supabase status change but failed to apply it
  // must NOT be acked. Returning 200 here would silently drop a Pro grant or
  // revocation. Release the claim so a re-delivery is processed as a fresh
  // attempt (returns 500 to trigger it).
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
