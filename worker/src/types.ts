import type { JWTPayload } from 'jose';

type _EnvForExport = Env;
export type { _EnvForExport as Env };

export type Tier = 'PREMIUM' | 'FREE';

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
  language?: string;
}

// ─── Auth Types ───────────────────────────────────────────────────

export interface JWTPayloadWithMeta extends JWTPayload {
  sub?: string;
  email?: string;
  app_metadata?: { is_pro?: boolean };
}

export const CLIENT_ABORTED = "CLIENT_ABORTED";
