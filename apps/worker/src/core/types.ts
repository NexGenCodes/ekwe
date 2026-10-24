import type { JWTPayload } from "jose";

// The global `Env` interface is declared in src/core/env.d.ts and merged with
// the Wrangler-generated __BaseEnv_Env via worker-configuration.d.ts.
// We intersect with an explicit optional-extras type here so that fields like
// EMAIL, SYNC_PUSH_COOLDOWN_MS, EDGE_CLIENT_TOKEN and TTS_GEMINI_VOICE are
// always visible on the exported Env, regardless of ambient-merge ordering.
type _EnvExtras = {
  EMAIL?: SendEmail;
  SYNC_PUSH_COOLDOWN_MS?: string;
  EDGE_CLIENT_TOKEN?: string;
  TTS_GEMINI_VOICE?: string;
};
type _EnvForExport = Env & _EnvExtras;
export type { _EnvForExport as Env };

export type { Tier, UsageType } from "@ekwe/shared";

export type TranscribeResult = import("@ekwe/shared").TranscribeResponse;
export type TranslateResult = import("@ekwe/shared").TranslateResponse;

interface SpeechAudioResult {
  audio: Uint8Array;
  mime: string;
  provider: string;
}

export interface SpeechAttempt {
  result: SpeechAudioResult | null;
  status: number | null;
}

export interface JWTPayloadWithMeta extends JWTPayload {
  sub?: string;
  email?: string;
  app_metadata?: { is_pro?: boolean };
  session_id?: string;
}

export const CLIENT_ABORTED = "CLIENT_ABORTED";

// A language-gated capability is exactly the shared registry's capability
// union, so the two cannot drift: adding a capability to the registry without
// teaching the worker about it is a compile error rather than a silent gap.
type LanguageGatedCapability =
  import("@ekwe/shared/languageCapabilities").LanguageCapability;

export type ProviderCapability =
  LanguageGatedCapability | "ttsStream" | "sttStream";

export type SpeechGender = "male" | "female";

export type SttFn = (
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
) => Promise<TranscribeResult | null>;

export type SttStreamFn = (
  env: Env,
  /**
   * The route to open. A provider can serve more than one streaming model, and
   * the route carries the static half of the request: model name, language set,
   * wire format.
   */
  route: import("@ekwe/shared").StreamRoute,
  /**
   * The language resolved for this session, or "auto". Dynamic, and different
   * from the route's own list, because it may have been pinned by an earlier
   * provider before this one was attached.
   */
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
) => Promise<boolean>;

export type TttFn = (
  text: string,
  request: TttRequest,
  env: Env,
  signal: AbortSignal,
) => Promise<TranslateResult | null>;

/**
 * Languages are canonical codes, never display names: the provider maps them
 * into whatever its API wants, as an `stt` provider does. `transliteration` is
 * resolved request shape, not policy — anything a plan restricts is stripped
 * from the result after the fact.
 */
export interface TttRequest {
  readonly targetLang: string;
  readonly sourceLang?: string;
  readonly transliteration: boolean;
}

export type TtsFn = (
  text: string,
  lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
) => Promise<SpeechAttempt>;

/**
 * A provider's own best voices for a gender, most-preferred first. Providers
 * declare *capability* only — they have no knowledge of product voice slots,
 * tiers, or failover policy. `gender` is undefined when the client has not
 * chosen, in which case the provider returns its neutral default first.
 */
type VoiceListFn = (
  gender: SpeechGender | undefined,
  langCode: string,
) => string[];

export interface ProviderModule {
  name: string;
  capabilities: readonly ProviderCapability[];
  /**
   * Streaming is keyed on a route id rather than a capability name, because one
   * provider can serve several streaming models with different language
   * coverage. Declaring an id here is how a provider claims a route; the
   * pipeline only ever offers routes some module claims.
   */
  streamRoutes?: readonly string[];
  stt?: SttFn;
  sttStream?: SttStreamFn;
  ttt?: TttFn;
  tts?: TtsFn;
  voices?: VoiceListFn;
}
