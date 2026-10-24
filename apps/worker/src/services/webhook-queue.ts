import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { processWebhookEvent } from "@/services/billing";

/**
 * Shape of a message enqueued to `ekwe-webhook-retry`.
 *
 * We store the minimal information needed to re-process the event:
 * the verified provider name and the parsed event body. Storing the
 * raw body would require re-verification, which we skip because the
 * webhook handler already verified the HMAC before enqueuing.
 */
export interface WebhookRetryMessage {
  /** Provider name as returned by `verifyWebhook` (e.g. "flutterwave"). */
  provider: string;
  /** Parsed, verified event payload. */
  event: Record<string, unknown>;
  /** ISO timestamp of the original inbound request, for observability. */
  originalAt: string;
  /** Number of times this message has been re-queued (not CF retries). */
  attempt: number;
}

/**
 * Process a single queue message.  If `fullyApplied` is false the message is
 * re-thrown so Cloudflare redelivers it (up to max_retries in wrangler.jsonc).
 */
async function processQueueMessage(
  message: Message<WebhookRetryMessage>,
  env: Env,
): Promise<void> {
  const { provider, event, originalAt, attempt } = message.body;

  logger.info("[webhook-queue] Processing retry message", {
    provider,
    attempt,
    originalAt,
    messageId: message.id,
  });

  const { fullyApplied } = await processWebhookEvent(provider, event, env);

  if (!fullyApplied) {
    // Throwing causes Cloudflare to redeliver with exponential back-off.
    throw new Error(
      `[webhook-queue] Event not fully applied (attempt=${attempt}); retrying`,
    );
  }

  logger.info("[webhook-queue] Retry succeeded", {
    provider,
    attempt,
    messageId: message.id,
  });
}

/**
 * Cloudflare Queue batch consumer for `ekwe-webhook-retry`.
 *
 * Each message is acknowledged individually: a single bad message does not
 * block the rest of the batch.
 */
export async function handleWebhookQueue(
  batch: MessageBatch<WebhookRetryMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processQueueMessage(message, env);
      message.ack();
    } catch (err) {
      logger.error("[webhook-queue] Message processing failed, will retry", {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // retry() schedules redelivery with Cloudflare's built-in back-off.
      message.retry();
    }
  }
}
