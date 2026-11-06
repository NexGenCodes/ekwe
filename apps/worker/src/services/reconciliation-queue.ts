import { logger } from "@/core/logger";
import type { Env } from "@/core/types";
import { reconcileFlutterwaveTransactions } from "@/services/flutterwave";

export interface ReconciliationMessage {
  type: "flutterwave-reconcile";
  daysAgo: number;
  originalAt: string;
  attempt: number;
}

export function isReconciliationMessage(
  body: unknown,
): body is ReconciliationMessage {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: unknown }).type === "flutterwave-reconcile"
  );
}

export async function enqueueReconciliation(
  env: Env,
  daysAgo = 2,
): Promise<boolean> {
  if (!env.RECONCILIATION_QUEUE) return false;
  await env.RECONCILIATION_QUEUE.send({
    type: "flutterwave-reconcile",
    daysAgo,
    originalAt: new Date().toISOString(),
    attempt: 1,
  } satisfies ReconciliationMessage);
  logger.warn("[reconciliation] Enqueued for queue retry", { daysAgo });
  return true;
}

async function processMessage(
  message: Message<ReconciliationMessage>,
  env: Env,
): Promise<void> {
  logger.info("[reconciliation-queue] Processing", {
    attempt: message.body.attempt,
    originalAt: message.body.originalAt,
    messageId: message.id,
  });
  await reconcileFlutterwaveTransactions(env, undefined, {
    enqueueOnFailure: false,
    daysAgo: message.body.daysAgo,
  });
  logger.info("[reconciliation-queue] Succeeded", {
    messageId: message.id,
  });
}

export async function handleReconciliationQueue(
  batch: MessageBatch<ReconciliationMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processMessage(message, env);
      message.ack();
    } catch (err) {
      logger.warn("[reconciliation-queue] Failed, will retry", {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
    }
  }
}
