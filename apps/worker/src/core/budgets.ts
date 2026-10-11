export const TRANSCRIBE_TOTAL_MS = 25_000;
export const TRANSCRIBE_CACHE_TTL_SECONDS = 4 * 60 * 60;

export const TRANSLATE_TOTAL_MS = 20_000;
export const TRANSLATE_CACHE_TTL_SECONDS = 4 * 60 * 60;
export const SYNTHESIZE_TOTAL_MS = 25_000;

/** Per-attempt cap for a provider with no entry in `PROVIDER_TIMEOUT`. */
export const FALLBACK_ATTEMPT_TIMEOUT_MS = {
  transcribe: 15_000,
  translate: 10_000,
} as const;

export const SPEECH_PIPELINE_TOTAL_MS = 20_000;
// Per-attempt cap for the TTS leg to prevent one provider consuming the whole budget.
export const SPEECH_PER_PROVIDER_MS = 8_000;
// 24h bounds cache pinning to one self-healing cycle.
export const SPEECH_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SPEECH_DOWN_TTL_SECONDS = 23 * 60 * 60;
// Hybrid speech cache: KV for small audio (fast), R2 for large audio.
export const SPEECH_KV_CACHE_MAX_BYTES = 256 * 1024;
export const SPEECH_R2_CACHE_MAX_BYTES = 10 * 1024 * 1024;
export const SPEECH_R2_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
