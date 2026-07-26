import { Env } from '../types';
import { logger } from '../logger';
import { verifyWebhook, WebhookProvider } from '../signatures';

const WEBHOOK_MAX_BYTES = 256 * 1024; // 256KB
const IDEMPOTENCY_TTL = 86400; // 24 hours

async function setProStatus(
  env: Env,
  identifier: { email?: string; userId?: string },
  isPro: boolean,
): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error(
      '[webhook] Missing Supabase credentials to update subscription',
    );
    return;
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/set_pro_status`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_email: identifier.email || null,
        p_user_id: identifier.userId || null,
        p_is_pro: isPro,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(
        `[webhook] Failed to update pro status. Response: ${errorText}`,
      );
    } else {
      logger.info(
        `[webhook] Successfully set pro status to ${isPro} for ${identifier.email || identifier.userId}`,
      );
    }
  } catch (err) {
    logger.error(
      `[webhook] Error updating pro status: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function setSubscriptionStatus(
  env: Env,
  emailOrUserId: string,
  isPro: boolean,
): Promise<void> {
  const isEmail = emailOrUserId.includes('@');
  await setProStatus(
    env,
    isEmail ? { email: emailOrUserId } : { userId: emailOrUserId },
    isPro,
  );
}

async function processPaystackEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:paystack] Event: ${eventType}`, {
    reference: data?.reference,
  });

  switch (eventType) {
    case 'charge.success': {
      const metadata = data?.metadata as Record<string, unknown> | undefined;
      const userId = metadata?.user_id as string | undefined;
      const email = (data?.customer as Record<string, unknown>)
        ?.email as string | undefined;

      if (!userId && !email) {
        logger.warn(
          '[webhook:paystack] Missing both user_id and email in charge.success',
        );
        return Response.json({ received: true, action: 'skipped' });
      }

      const identifier = userId ?? email!;
      await setSubscriptionStatus(env, identifier, true);

      logger.info(
        `[webhook:paystack] charge.success processed for ${identifier} (via ${userId ? 'user_id' : 'email'})`,
      );
      return Response.json({ received: true, action: 'activated' });
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      const email = (data?.customer as Record<string, unknown>)
        ?.email as string;
      if (email) {
        await setSubscriptionStatus(env, email, false);
        logger.info(`[webhook:paystack] Subscription ended for ${email}`);
      }
      return Response.json({ received: true, action: 'deactivated' });
    }

    default:
      logger.info(`[webhook:paystack] Unhandled event: ${eventType}`);
      return Response.json({ received: true, action: 'ignored' });
  }
}

async function processFlutterwaveEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:flutterwave] Event: ${eventType}`, {
    txRef: data?.tx_ref,
  });

  switch (eventType) {
    case 'charge.completed': {
      const status = data?.status as string;
      if (status !== 'successful') {
        logger.warn(`[webhook:flutterwave] Non-successful charge: ${status}`);
        return Response.json({ received: true, action: 'skipped' });
      }

      const meta = data?.meta as Record<string, unknown> | undefined;
      const userId = meta?.user_id as string | undefined;
      const email = (data?.customer as Record<string, unknown>)
        ?.email as string | undefined;

      if (!userId && !email) {
        logger.warn('[webhook:flutterwave] Missing both user_id and email');
        return Response.json({ received: true, action: 'skipped' });
      }

      const identifier = userId ?? email!;
      await setSubscriptionStatus(env, identifier, true);

      logger.info(
        `[webhook:flutterwave] Payment successful for ${identifier} (via ${userId ? 'user_id' : 'email'})`,
      );
      return Response.json({ received: true, action: 'activated' });
    }

    default:
      logger.info(`[webhook:flutterwave] Unhandled event: ${eventType}`);
      return Response.json({ received: true, action: 'ignored' });
  }
}

async function processRevenueCatEvent(
  event: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const eventData = event.event as Record<string, unknown> | undefined;
  const eventType = eventData?.type as string;

  logger.info(`[webhook:revenuecat] Event: ${eventType}`);

  const activationEvents = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'UNCANCELLATION',
    'NON_RENEWING_PURCHASE',
  ]);

  const deactivationEvents = new Set([
    'EXPIRATION',
    'CANCELLATION',
    'BILLING_ISSUE',
  ]);

  const appUserId = eventData?.app_user_id as string;
  if (!appUserId) {
    logger.warn('[webhook:revenuecat] Missing app_user_id');
    return Response.json({ received: true, action: 'skipped' });
  }

  if (activationEvents.has(eventType)) {
    await setSubscriptionStatus(env, appUserId, true);
    logger.info(`[webhook:revenuecat] Subscription activated for ${appUserId}`);
    return Response.json({ received: true, action: 'activated' });
  }

  if (deactivationEvents.has(eventType)) {
    await setSubscriptionStatus(env, appUserId, false);
    logger.info(`[webhook:revenuecat] Subscription ended for ${appUserId}`);
    return Response.json({ received: true, action: 'deactivated' });
  }

  logger.info(`[webhook:revenuecat] Unhandled event: ${eventType}`);
  return Response.json({ received: true, action: 'ignored' });
}

const PROCESSORS: Record<
  WebhookProvider,
  (event: Record<string, unknown>, env: Env) => Promise<Response>
> = {
  paystack: processPaystackEvent,
  flutterwave: processFlutterwaveEvent,
  revenuecat: processRevenueCatEvent,
  unknown: async () =>
    Response.json({ error: 'UNKNOWN_PROVIDER' }, { status: 400 }),
};

export async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  // Max size guard
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > WEBHOOK_MAX_BYTES) {
    logger.warn(`[webhook] Payload too large: ${contentLength} bytes`);
    return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  const rawBody = await request.text();

  if (rawBody.length > WEBHOOK_MAX_BYTES) {
    logger.warn(`[webhook] Body exceeds size limit: ${rawBody.length} bytes`);
    return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }

  // Idempotency: hash body to deduplicate duplicate webhook deliveries
  const bodyHash = await hashString(rawBody);
  const idempotencyKey = `webhook:idempotency:${bodyHash}`;

  if (env.EKWE_KV) {
    const existing = await env.EKWE_KV.get(idempotencyKey);
    if (existing) {
      logger.info(`[webhook] Duplicate event detected (hash: ${bodyHash.slice(0, 8)})`);
      return Response.json({ received: true, action: 'duplicate' });
    }
  }

  const verification = await verifyWebhook(request, rawBody, env);

  if (!verification.isValid) {
    logger.warn(
      `[webhook] Rejected: provider=${verification.provider}, error=${verification.error || 'signature mismatch'}`,
    );
    return Response.json(
      {
        error: 'INVALID_SIGNATURE',
        message: 'Webhook signature verification failed.',
      },
      { status: 401 },
    );
  }

  logger.info(`[webhook] Verified: provider=${verification.provider}`);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn('[webhook] Valid signature but malformed JSON body', { provider: verification.provider });
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const processor = PROCESSORS[verification.provider];
  const response = await processor(event, env);

  // Store idempotency key after successful processing
  if (env.EKWE_KV && response.ok) {
    const ctx = (globalThis as { currentExecutionContext?: ExecutionContext }).currentExecutionContext;
    if (ctx) {
      ctx.waitUntil(
        env.EKWE_KV.put(idempotencyKey, '1', { expirationTtl: IDEMPOTENCY_TTL })
          .catch((err: unknown) => logger.error('[webhook] Failed to store idempotency key', { error: String(err) })),
      );
    }
  }

  return response;
}

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}
