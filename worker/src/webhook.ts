import { Env } from './types';
import { logger } from './logger';
import { verifyWebhook, WebhookProvider } from './signatures';

/**
 * ─── Subscription Lifecycle Management ────────────────────────────
 */

async function setProStatus(env: Env, identifier: { email?: string; userId?: string }, isPro: boolean): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('[webhook] Missing Supabase credentials to update subscription');
    return;
  }

  try {
    // We use a custom RPC because updating app_metadata by email requires admin privileges
    // and querying the auth.users table is restricted. The RPC 'set_pro_status' handles
    // finding the user by email OR userId and updating their app_metadata.is_pro flag.
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/set_pro_status`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_email: identifier.email || null,
        p_user_id: identifier.userId || null,
        p_is_pro: isPro
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      logger.error(`[webhook] Failed to update pro status. Response: ${errorText}`);
    } else {
      logger.info(`[webhook] Successfully set pro status to ${isPro} for ${identifier.email || identifier.userId}`);
    }
  } catch (err) {
    logger.error(`[webhook] Error updating pro status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function activateSubscription(env: Env, emailOrUserId: string, reference?: string): Promise<void> {
  const isEmail = emailOrUserId.includes('@');
  await setProStatus(env, isEmail ? { email: emailOrUserId } : { userId: emailOrUserId }, true);
}

async function deactivateSubscription(env: Env, emailOrUserId: string): Promise<void> {
  const isEmail = emailOrUserId.includes('@');
  await setProStatus(env, isEmail ? { email: emailOrUserId } : { userId: emailOrUserId }, false);
}

/**
 * ─── Unified Webhook Handler ──────────────────────────────────────
 *
 * Receives POST requests at /webhook, verifies the signature using
 * the provider-agnostic verifier in signatures.ts, and then dispatches
 * the event to the correct processor.
 *
 * The handler reads the raw body ONCE as text (for signature verification),
 * then parses it as JSON only after the signature is confirmed valid.
 * This prevents any processing of untrusted payloads.
 */

// ─── Provider-specific Event Processors ──────────────────────────

async function processPaystackEvent(event: Record<string, unknown>, env: Env): Promise<Response> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:paystack] Event: ${eventType}`, { reference: data?.reference });

  switch (eventType) {
    case 'charge.success': {
      // Extract fields for subscription activation
      const email = (data?.customer as Record<string, unknown>)?.email as string;
      const reference = data?.reference as string;

      if (!email || !reference) {
        logger.warn('[webhook:paystack] Missing email or reference in charge.success');
        return Response.json({ received: true, action: 'skipped' });
      }

      await activateSubscription(env, email, reference);

      logger.info(`[webhook:paystack] charge.success processed for ${email}`);
      return Response.json({ received: true, action: 'activated' });
    }

    case 'subscription.disable':
    case 'subscription.not_renew': {
      const email = (data?.customer as Record<string, unknown>)?.email as string;
      if (email) {
        await deactivateSubscription(env, email);
        logger.info(`[webhook:paystack] Subscription ended for ${email}`);
      }
      return Response.json({ received: true, action: 'deactivated' });
    }

    default:
      logger.info(`[webhook:paystack] Unhandled event: ${eventType}`);
      return Response.json({ received: true, action: 'ignored' });
  }
}

async function processFlutterwaveEvent(event: Record<string, unknown>, env: Env): Promise<Response> {
  const eventType = event.event as string;
  const data = event.data as Record<string, unknown>;

  logger.info(`[webhook:flutterwave] Event: ${eventType}`, { txRef: data?.tx_ref });

  switch (eventType) {
    case 'charge.completed': {
      const status = data?.status as string;
      if (status !== 'successful') {
        logger.warn(`[webhook:flutterwave] Non-successful charge: ${status}`);
        return Response.json({ received: true, action: 'skipped' });
      }

      const email = (data?.customer as Record<string, unknown>)?.email as string;
      const txRef = data?.tx_ref as string;

      if (!email || !txRef) {
        logger.warn('[webhook:flutterwave] Missing email or tx_ref');
        return Response.json({ received: true, action: 'skipped' });
      }

      await activateSubscription(env, email, txRef);

      logger.info(`[webhook:flutterwave] Payment successful for ${email}`);
      return Response.json({ received: true, action: 'activated' });
    }

    default:
      logger.info(`[webhook:flutterwave] Unhandled event: ${eventType}`);
      return Response.json({ received: true, action: 'ignored' });
  }
}

async function processRevenueCatEvent(event: Record<string, unknown>, env: Env): Promise<Response> {
  const eventData = event.event as Record<string, unknown> | undefined;
  const eventType = eventData?.type as string;

  logger.info(`[webhook:revenuecat] Event: ${eventType}`);

  // RevenueCat event types for subscription lifecycle
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
    await activateSubscription(env, appUserId);
    logger.info(`[webhook:revenuecat] Subscription activated for ${appUserId}`);
    return Response.json({ received: true, action: 'activated' });
  }

  if (deactivationEvents.has(eventType)) {
    await deactivateSubscription(env, appUserId);
    logger.info(`[webhook:revenuecat] Subscription ended for ${appUserId}`);
    return Response.json({ received: true, action: 'deactivated' });
  }

  logger.info(`[webhook:revenuecat] Unhandled event: ${eventType}`);
  return Response.json({ received: true, action: 'ignored' });
}

// ─── Dispatcher ───────────────────────────────────────────────────

const PROCESSORS: Record<WebhookProvider, (event: Record<string, unknown>, env: Env) => Promise<Response>> = {
  paystack: processPaystackEvent,
  flutterwave: processFlutterwaveEvent,
  revenuecat: processRevenueCatEvent,
  unknown: async () => Response.json({ error: 'UNKNOWN_PROVIDER' }, { status: 400 }),
};

// ─── Main Webhook Handler ─────────────────────────────────────────

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // 1. Read raw body ONCE (needed for signature verification)
  const rawBody = await request.text();

  // 2. Verify signature (provider auto-detected from headers)
  const verification = await verifyWebhook(request, rawBody, env);

  if (!verification.isValid) {
    logger.warn(`[webhook] Rejected: provider=${verification.provider}, error=${verification.error || 'signature mismatch'}`);
    return Response.json(
      { error: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' },
      { status: 401 },
    );
  }

  logger.info(`[webhook] Verified: provider=${verification.provider}`);

  // 3. Parse JSON ONLY after signature is confirmed valid
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.warn('[webhook] Valid signature but malformed JSON body');
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  // 4. Dispatch to provider-specific processor
  const processor = PROCESSORS[verification.provider];
  return processor(event, env);
}
