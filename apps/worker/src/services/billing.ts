/**
 * ─── Billing Provider Registry ───────────────────────────────────
 *
 * Maps each payment provider to its webhook handler, configuration, and
 * verification logic. New providers are added here — the router in index.ts
 * stays unchanged.
 */

import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env } from "../core/types";
import { logger } from "../core/logger";

// ─── Types ───────────────────────────────────────────────────────

export interface ProviderResult {
  response: Response;
  fullyApplied: boolean;
}

export type ProviderProcessor = (
  event: Record<string, unknown>,
  env: Env,
) => Promise<ProviderResult>;

export interface ProviderConfig {
  /** Whether this provider is enabled via environment secrets. */
  enabled: (env: Env) => boolean;
  /** The webhook event processor. */
  process: ProviderProcessor;
}

// ─── Registry ────────────────────────────────────────────────────

const registry = new Map<string, ProviderConfig>();

export function registerProvider(name: string, config: ProviderConfig): void {
  registry.set(name, config);
}

export function getProvider(name: string): ProviderConfig | undefined {
  return registry.get(name);
}

export function hasProvider(name: string): boolean {
  return registry.has(name);
}

// ─── Unknown Provider Fallback ───────────────────────────────────
// Always available — catches anything that doesn't match a registered provider.

export const unknownProvider: ProviderProcessor = () =>
  Promise.resolve({
    response: Response.json(
      { error: WORKER_ERROR_CODES.UNKNOWN_PROVIDER },
      { status: 400 },
    ),
    fullyApplied: true,
  });

/**
 * Processes a webhook event by looking up the registered provider and
 * delegating to its processor. Falls back to the unknown provider handler
 * if no matching provider is found.
 */
export async function processWebhookEvent(
  providerName: string,
  event: Record<string, unknown>,
  env: Env,
): Promise<ProviderResult> {
  const config = registry.get(providerName);
  if (!config) {
    logger.warn(`[billing] Unknown provider: ${providerName}`);
    return unknownProvider(event, env);
  }

  if (!config.enabled(env)) {
    logger.warn(`[billing] Provider disabled: ${providerName}`);
    return {
      response: Response.json(
        { error: WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE },
        { status: 503 },
      ),
      fullyApplied: true,
    };
  }

  return config.process(event, env);
}
