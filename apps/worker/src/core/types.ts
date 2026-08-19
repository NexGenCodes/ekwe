import type { JWTPayload } from "jose";

type _EnvForExport = Env;
export type { _EnvForExport as Env };

export type { Tier, UsageType } from "@ekwe/shared";

// ─── Billing Provider Secrets ────────────────────────────────────
// FLUTTERWAVE_SECRET: Flutterwave API secret key (FLWSECK_...) used as the
// Authorization bearer for checkout/payment API calls.
// FLUTTERWAVE_WEBHOOK_SECRET: The webhook secret hash configured in the
// Flutterwave dashboard (Settings → Webhooks). Used to verify inbound
// webhooks via the `verif-hash` header (plain equality) and/or the
// `flutterwave-signature` header (HMAC-SHA256 over the raw body, base64).
// Both are set as Cloudflare Worker secrets (never in wrangler.jsonc).

// ─── Provider Contracts ───────────────────────────────────────────
// The transcribe/translate provider results ARE the wire responses, so the
// authoritative shape lives in @ekwe/shared (zod schemas) and the worker only
// aliases it here. Anything a provider returns beyond these fields is dropped
// by the schema gate in the routes before it can reach a client.

export type TranscribeResult = import("@ekwe/shared").TranscribeResponse;
export type TranslateResult = import("@ekwe/shared").TranslateResponse;

// ─── Text-to-Speech Contracts ──────────────────────────────────────

interface TtsAudioResult {
  audio: Uint8Array;
  mime: string;
  provider: string;
}

/**
 * Outcome of a single TTS provider attempt. `status` is the terminal HTTP
 * status when the provider failed (used to detect day-long exhaustion:
 * 429/403), or null when the attempt failed without a meaningful provider
 * status (exception, empty output, malformed payload, ...).
 */
export interface TtsAttempt {
  result: TtsAudioResult | null;
  status: number | null;
}

// ─── Auth Types ───────────────────────────────────────────────────

export interface JWTPayloadWithMeta extends JWTPayload {
  sub?: string;
  email?: string;
  app_metadata?: { is_pro?: boolean };
  /**
   * Supabase session UUID claim. Cross-checked against auth.sessions on
   * billable routes so a deleted user's still-valid JWT stops working
   * immediately instead of running until `exp`.
   */
  session_id?: string;
}

export const CLIENT_ABORTED = "CLIENT_ABORTED";
