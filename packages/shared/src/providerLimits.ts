import type { ProviderId } from "./languageCapabilities";

/**
 * Codec as the wire carries it. Container is separate: `audio/ogg` is ambiguous
 * between Vorbis and Opus, and that difference decides whether Wit can be used.
 */
export type AudioCodec =
  | "vorbis"
  | "opus"
  | "mp3"
  | "aac"
  | "m4a"
  | "wav"
  | "flac"
  | "webm"
  | "amr"
  | "ulaw"
  | "pcm"
  | "aiff"
  | "caf"
  | "unknown";

/** Every codec the platform can produce or accept, for `codecs: "any"`. */
export const ALL_AUDIO_CODECS: readonly AudioCodec[] = [
  "vorbis",
  "opus",
  "mp3",
  "aac",
  "m4a",
  "wav",
  "flac",
  "webm",
  "amr",
  "ulaw",
  "pcm",
  "aiff",
  "caf",
];

export interface SttLimits {
  readonly kind: "stt";
  /** Largest upload the endpoint accepts. `Infinity` where undocumented. */
  readonly maxBytes: number;
  readonly maxDurationMs: number;
  /** Shortest clip the endpoint will answer at all. */
  readonly minDurationMs: number;
  readonly codecs: readonly AudioCodec[] | "any";
  /**
   * The endpoint has no way to infer the language. Two different causes are
   * kept apart because they are fixed differently: `required` means the API
   * demands the field (Cohere's `language` is mandatory), `impossible` means
   * the architecture forbids it (Wit holds one key per language, so asking it
   * to detect would just pick a key arbitrarily).
   */
  readonly autoDetect: "supported" | "required" | "impossible";
}

export interface TttLimits {
  readonly kind: "ttt";
  readonly maxInputChars: number;
  readonly maxOutputChars: number;
  /** Whether a source language may be left for the model to infer. */
  readonly autoDetectSource: boolean;
}

export interface TtsLimits {
  readonly kind: "tts";
  readonly maxInputChars: number;
  readonly maxOutputBytes: number;
  /** Below this the response is silence, not speech. */
  readonly minOutputBytes: number;
}

export type ProviderLimitsFor<K extends "stt" | "ttt" | "tts"> = K extends "stt"
  ? SttLimits
  : K extends "ttt"
    ? TttLimits
    : TtsLimits;

export interface ProviderLimitsEntry {
  readonly stt?: SttLimits;
  readonly ttt?: TttLimits;
  readonly tts?: TtsLimits;
  /** Where each number came from. Published facts that go stale. */
  readonly citations: readonly string[];
}

export const MB = 1024 * 1024;

/** Wit.ai `/dictation` ceiling, per its docs. */
export const WITAI_MAX_DURATION_MS = 300_000;

/**
 * What the client encodes to Vorbis for: 4% under the documented cap. Our
 * decoded duration and Wit's own parse can disagree on where a clip ends, and
 * a clip we read as 299s that Wit parses as 301s is rejected with no useful
 * error.
 */
export const WITAI_SAFE_DURATION_MS = 288_000;

/** Wit returns this exact silence payload for scripts it cannot voice. */
export const WITAI_MIN_SPEECH_BYTES = 1_200;

/**
 * Workers AI takes base64, so the budget must survive a 4/3 inflation. The
 * model rejects past ~2MB decoded; this is that ceiling in bytes as received.
 */
export const CF_WORKERS_AI_MAX_AUDIO_BYTES = Math.floor((2 * MB * 3) / 4);

/**
 * Measured ceilings, each traced to a vendor page via `citations`.
 *
 * Deliberately conservative rather than maximal: this table decides what gets
 * skipped. Skipping a provider that would have worked costs a slower answer;
 * calling one that will reject costs the whole attempt budget.
 */
export const PROVIDER_LIMITS = {
  witai: {
    stt: {
      kind: "stt",
      maxBytes: Infinity,
      maxDurationMs: WITAI_MAX_DURATION_MS,
      minDurationMs: 0,
      // Opus-in-Ogg gets an empty transcript, not an error — a silent wrong
      // answer, which is worse than a failure.
      codecs: ["vorbis", "wav", "mp3", "webm", "ulaw", "pcm"],
      autoDetect: "impossible",
    },
    tts: {
      kind: "tts",
      maxInputChars: 2_500,
      maxOutputBytes: 8 * MB,
      minOutputBytes: WITAI_MIN_SPEECH_BYTES,
    },
    citations: [
      "https://wit.ai/docs/http",
      "https://github.com/wit-ai/wit/issues/2671",
    ],
  },

  groq: {
    stt: {
      kind: "stt",
      // The advertised 100MB is URL-only; file upload caps at 25MB.
      maxBytes: 25 * MB,
      maxDurationMs: Infinity,
      minDurationMs: 10,
      codecs: "any",
      // Needs `verbose_json`; plain `json` omits the detected language.
      autoDetect: "supported",
    },
    ttt: {
      kind: "ttt",
      maxInputChars: 24_000,
      maxOutputChars: 8_000,
      autoDetectSource: true,
    },
    citations: ["https://console.groq.com/docs/speech-to-text"],
  },

  cloudflare: {
    stt: {
      kind: "stt",
      maxBytes: CF_WORKERS_AI_MAX_AUDIO_BYTES,
      maxDurationMs: Infinity,
      minDurationMs: 0,
      codecs: "any",
      autoDetect: "supported",
    },
    ttt: {
      kind: "ttt",
      maxInputChars: 8_000,
      maxOutputChars: 4_000,
      autoDetectSource: true,
    },
    citations: [
      "https://community.cloudflare.com/t/workers-ai-speech-recognition-request-limits/662925",
    ],
  },

  cohere: {
    stt: {
      kind: "stt",
      maxBytes: 25 * MB,
      maxDurationMs: Infinity,
      minDurationMs: 0,
      // MP4/M4A and WEBM are unsupported, unlike the OpenAI-compatible
      // endpoint this mirrors.
      codecs: ["flac", "mp3", "vorbis", "opus", "wav", "webm"],
      autoDetect: "required",
    },
    ttt: {
      kind: "ttt",
      maxInputChars: 32_000,
      maxOutputChars: 8_000,
      autoDetectSource: true,
    },
    citations: [
      "https://docs.cohere.com/docs/transcribe",
      "https://docs.cohere.com/reference/create-audio-transcription",
    ],
  },

  deepgram: {
    stt: {
      kind: "stt",
      maxBytes: 2 * 1024 * MB,
      // Past ~10min of processing the API returns 504.
      maxDurationMs: 10 * 60_000,
      minDurationMs: 0,
      codecs: "any",
      autoDetect: "supported",
    },
    tts: {
      kind: "tts",
      maxInputChars: 2_400,
      maxOutputBytes: 8 * MB,
      minOutputBytes: 0,
    },
    citations: ["https://developers.deepgram.com/docs/pre-recorded-audio"],
  },

  assemblyai: {
    stt: {
      kind: "stt",
      // `/v2/upload` ceiling, the path this worker uses.
      maxBytes: 2_200 * MB,
      maxDurationMs: 10 * 60 * 60_000,
      minDurationMs: 160,
      codecs: "any",
      autoDetect: "supported",
    },
    citations: [
      "https://support.assemblyai.com/articles/9208125065-are-there-any-limits-on-file-size-or-file-duration-for-files-submitted-to-the-api",
    ],
  },

  elevenlabs: {
    stt: {
      kind: "stt",
      maxBytes: 3 * 1024 * MB,
      maxDurationMs: 10 * 60 * 60_000,
      minDurationMs: 100,
      codecs: "any",
      autoDetect: "supported",
    },
    tts: {
      kind: "tts",
      maxInputChars: 2_400,
      maxOutputBytes: 8 * MB,
      minOutputBytes: 0,
    },
    citations: [
      "https://elevenlabs.io/docs/overview/capabilities/speech-to-text",
    ],
  },

  gladia: {
    stt: {
      kind: "stt",
      maxBytes: 1_000 * MB,
      maxDurationMs: 135 * 60_000,
      minDurationMs: 0,
      codecs: "any",
      autoDetect: "supported",
    },
    citations: [
      "https://docs.gladia.io/chapters/limits-and-specifications/supported-formats",
    ],
  },

  // Text-to-text and text-to-speech only; neither appears in an STT pool.
  mistral: {
    ttt: {
      kind: "ttt",
      maxInputChars: 32_000,
      maxOutputChars: 8_000,
      autoDetectSource: true,
    },
    citations: ["https://docs.mistral.ai/"],
  },

  openrouter: {
    ttt: {
      kind: "ttt",
      maxInputChars: 24_000,
      maxOutputChars: 8_000,
      autoDetectSource: true,
    },
    citations: ["https://openrouter.ai/docs"],
  },

  gemini: {
    ttt: {
      kind: "ttt",
      maxInputChars: 100_000,
      maxOutputChars: 8_192,
      autoDetectSource: true,
    },
    tts: {
      kind: "tts",
      maxInputChars: 8_000,
      maxOutputBytes: 8 * MB,
      minOutputBytes: 0,
    },
    citations: ["https://ai.google.dev/gemini-api/docs"],
  },

  edge: {
    tts: {
      kind: "tts",
      maxInputChars: 2_400,
      maxOutputBytes: 8 * MB,
      minOutputBytes: 0,
    },
    citations: [],
  },
} satisfies Record<ProviderId, ProviderLimitsEntry>;

export function sttLimits(provider: string): SttLimits | null {
  const entry = (PROVIDER_LIMITS as Record<string, ProviderLimitsEntry>)[
    provider
  ];
  return entry?.stt ?? null;
}

export function tttLimits(provider: string): TttLimits | null {
  const entry = (PROVIDER_LIMITS as Record<string, ProviderLimitsEntry>)[
    provider
  ];
  return entry?.ttt ?? null;
}

export function ttsLimits(provider: string): TtsLimits | null {
  const entry = (PROVIDER_LIMITS as Record<string, ProviderLimitsEntry>)[
    provider
  ];
  return entry?.tts ?? null;
}

export function providerAcceptsCodec(
  provider: string,
  codec: AudioCodec,
): boolean {
  const limits = sttLimits(provider);
  if (!limits) return true;
  if (limits.codecs === "any") return true;
  return limits.codecs.includes(codec);
}
