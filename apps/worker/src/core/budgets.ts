export const TRANSCRIBE_TOTAL_MS = 25_000;
export const TRANSCRIBE_CACHE_TTL_SECONDS = 4 * 60 * 60;

export const TRANSLATE_TOTAL_MS = 20_000;
export const TRANSLATE_PER_PROVIDER_MS = 10_000;
export const TRANSLATE_CACHE_TTL_SECONDS = 4 * 60 * 60;

export const SYNTHESIZE_TOTAL_MS = 25_000;

export const SPEECH_PIPELINE_TOTAL_MS = 20_000;
export const SPEECH_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const SPEECH_DOWN_TTL_SECONDS = 23 * 60 * 60;
// Hybrid speech cache: audio ≤ the KV cap stays in KV (hot, low latency); larger
// audio goes to R2 (no per-value size limit, ~10GB free). R2 has no TTL, so an
// expiresAt is stored in object custom metadata and lazily deleted on read; a
// bucket lifecycle rule acts as a backstop.
export const SPEECH_KV_CACHE_MAX_BYTES = 256 * 1024;
export const SPEECH_R2_CACHE_MAX_BYTES = 10 * 1024 * 1024;
export const SPEECH_R2_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
