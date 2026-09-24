import type { JWTPayload } from "jose";

type _EnvForExport = Env;
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

export type ProviderCapability =
  "translate" | "tts" | "stt" | "sttStream" | "ttsStream";

export type SpeechGender = "male" | "female";

export type SttFn = (
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
) => Promise<TranscribeResult | null>;

export type SttStreamFn = (
  env: Env,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
) => Promise<boolean>;

export type TranslateFn = (
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean,
) => Promise<TranslateResult | null>;

export type TtsFn = (
  text: string,
  lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
) => Promise<SpeechAttempt>;

type VoiceResolver = (
  voiceId: string | undefined,
  langCode: string,
  gender: SpeechGender,
) => string[];

export interface ProviderModule {
  name: string;
  capabilities: readonly ProviderCapability[];
  supportedLanguages?: ReadonlySet<string>;
  stt?: SttFn;
  sttStream?: SttStreamFn;
  translate?: TranslateFn;
  tts?: TtsFn;
  voice?: VoiceResolver;
}
