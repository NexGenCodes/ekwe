import { JWTPayload } from 'jose';

// ─── Infrastructure Bindings ──────────────────────────────────────

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface Env {
  [key: string]: unknown;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  EKWE_KV: KVNamespace;
  AI: AiBinding;
  RATE_LIMITER: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };

  // ─── Payment Webhook Secrets ──────────────────────────────────────
  PAYSTACK_SECRET_KEY?: string;
  FLUTTERWAVE_SECRET_HASH?: string;
  REVENUECAT_WEBHOOK_SECRET?: string;
}

export type Tier = 'PREMIUM' | 'CAPPED_PREMIUM' | 'FREE';

// ─── Provider Contracts ───────────────────────────────────────────

export interface TranscribeResult {
  text: string;
  provider: string;
  duration?: number;
  language?: string;
}

export interface TranslateResult {
  translation: string;
  provider: string;
}

// ─── Auth Types (kept for when auth is re-enabled) ────────────────

export interface JWTPayloadWithMeta extends JWTPayload {
  sub?: string;
  app_metadata?: { is_pro?: boolean };
}
