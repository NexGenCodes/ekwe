/**
 * Per-provider language capability, in one place.
 *
 * This knowledge was previously duplicated across the catalog, the worker and
 * each provider, and drifted: the Whisper family spells Javanese and Norwegian
 * Bokmal `jw`/`no` where everything else uses `jv`/`nb`, and a missed mapping
 * sent AssemblyAI and Gladia codes their APIs do not accept.
 *
 * Rules this module enforces by construction:
 *
 *  - `codes` is ALWAYS in our canonical spelling. A provider's own spelling
 *    lives in `aliases`, so a mapping cannot leak into storage or the UI.
 *  - `aliases` is per capability, not per provider. Whisper wants `jw` for
 *    speech-to-text while Wit and Cohere want `jv` for synthesis, so a single
 *    provider-wide map would corrupt the other direction.
 *  - Every entry is a subset of the shared catalog, asserted by test.
 *
 * Streaming is keyed on a (provider, model) pair in {@link STREAM_ROUTES},
 * because one provider can ship several streaming models with different
 * language coverage. Deepgram alone has two.
 */

import { LANGUAGE_CODES } from "./languages";
import { SUPPORTED_LANGUAGE_CODE_SET } from "./languages";

export type ProviderId =
  | "assemblyai"
  | "cloudflare"
  | "cohere"
  | "deepgram"
  | "edge"
  | "elevenlabs"
  | "gemini"
  | "gladia"
  | "groq"
  | "mistral"
  | "openrouter"
  | "witai";

/**
 * A file-shaped capability: one request, one transcript. Named by I/O shape,
 * not product intent, so it stays distinct from the product vocabulary that
 * names the same operation (`transcribe`, `speech`, `translate`).
 */
export type LanguageCapability = "stt" | "tts" | "ttt";

/**
 * How faithfully a provider can speak a language.
 *
 * `native` is a voice authored for that language. `multilingual` is a voice
 * that will read it with a non-native accent. Both are worth routing to; the
 * difference is what a caller may promise the user, so it is recorded rather
 * than flattened into a single boolean. A language in neither tier is one the
 * provider cannot speak at all and must be skipped.
 */
export type LanguageTier = "native" | "multilingual";

export interface LanguageCapabilitySpec {
  /** Canonical codes this provider accepts, in canonical spelling. */
  readonly codes: readonly string[];
  /**
   * The provider handles any language and takes no language selector, so
   * `codes` is not a boundary. Distinct from an empty `codes`, which means the
   * capability genuinely supports nothing we can route.
   */
  readonly unbounded?: true;
  /**
   * canonical -> provider spelling, only where the provider genuinely differs.
   * Absent means the provider speaks our codes verbatim.
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /**
   * The subset of `codes` served by a voice built for that language. Absent
   * means every listed code is cross-lingual. Unbounded specs are always
   * `multilingual`, since no language selector reaches the engine.
   */
  readonly native?: readonly string[];
}

/**
 * Whisper's 99-language tokenizer plus Norwegian Bokmal, which Whisper reaches
 * through its `no` token. This is the floor for batch transcription: any
 * language outside it can only be handled by a non-Whisper provider.
 */
const WHISPER_LANGUAGES: readonly string[] = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "ba",
  "be",
  "bg",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fo",
  "fr",
  "gl",
  "gu",
  "ha",
  "haw",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jv",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "la",
  "lb",
  "ln",
  "lo",
  "lt",
  "lv",
  "mg",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "nb",
  "ne",
  "nl",
  "nn",
  "no",
  "oc",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sa",
  "sd",
  "si",
  "sk",
  "sl",
  "sn",
  "so",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tk",
  "tl",
  "tr",
  "tt",
  "uk",
  "ur",
  "uz",
  "vi",
  "yi",
  "yo",
  "yue",
  "zh",
];

/**
 * Whisper spells two of our codes differently. Applied to speech-to-text only —
 * every other capability uses the canonical form.
 */
const WHISPER_ALIASES: Readonly<Record<string, string>> = {
  jv: "jw",
  nb: "no",
};

/**
 * Wit's speech-to-text set, verified one language per key against `/message`
 * with native audio rather than copied from Wit's docs.
 *
 * `te` is deliberately excluded. The endpoint answers `200` for Telugu, but the
 * transcript comes back as "Namaste" — a greeting rather than the spoken text —
 * so a `200` proves nothing here, and the registration would have routed Telugu
 * to a provider that silently returns the wrong words. Its `WIT_KEY_TE` was
 * pruned from the key store to match.
 *
 * This is a different list from {@link WIT_LANGUAGES} below, which covers
 * synthesis. Keeping them separate is what lets a language be offered for
 * transcription without being claimed for speech.
 */
const WIT_STT_LANGUAGES: readonly string[] = [
  "ar",
  "bn",
  "ca",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "hi",
  "id",
  "it",
  "ja",
  "kn",
  "ko",
  "ml",
  "mr",
  "ms",
  "my",
  "nl",
  "pl",
  "pt",
  "ru",
  "si",
  "sv",
  "ta",
  "th",
  "tl",
  "tr",
  "ur",
  "vi",
  "zh",
];

/**
 * The languages Wit's *synthesis* endpoint genuinely speaks, measured by
 * `check-tts.mjs` rather than taken from Wit's advertised coverage.
 *
 * The harness synthesizes a known phrase per language and transcribes it back.
 * The results split by script, not by the API's language list:
 *
 *   576 bytes   - silent no-audio payload: `hi`, `th`, `ta`, `te`
 *   ~3.4 KB     - clipped audio read character by character: `ja`, `ko`, `zh`, `ar`
 *   7.4 KB +    - real speech, transcribed correctly (Latin and Cyrillic alike)
 *
 * Wit answers `200` for every one of these either way, so a status check proves
 * nothing; only the audio does. This list previously held 131 languages on the
 * strength of the request being accepted, which routed Indic, Thai, CJK,
 * Hangul and Arabic synthesis to a provider that returns silence or a
 * character-by-character reading. `MIN_SPEECH_BYTES` in the provider now
 * rejects the silent response at runtime, and keeping this list honest stops the
 * pool choosing Wit for a script it cannot voice in the first place.
 *
 * `ru` and `ba` are kept deliberately: Cyrillic is voiced correctly, so the
 * cut is by script coverage rather than by "not Latin".
 *
 * The gap costs `hi`, `th`, `ta`, `te`, `ja`, `ko`, `zh` and `ar`, which must
 * route to Gemini or ElevenLabs instead of this fallback.
 */
const WIT_LANGUAGES: readonly string[] = [
  "af",
  "ba",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "eo",
  "es",
  "et",
  "eu",
  "fi",
  "fr",
  "ga",
  "gl",
  "haw",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ka",
  "la",
  "lb",
  "lt",
  "lv",
  "mk",
  "ms",
  "mt",
  "nb",
  "nn",
  "nl",
  "no",
  "oc",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sn",
  "so",
  "sq",
  "sr",
  "sv",
  "sw",
  "tk",
  "tr",
  "uk",
  "uz",
  "vi",
];

const COHERE_LANGUAGES: readonly string[] = [
  "ar",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "vi",
  "zh",
];

/**
 * Deepgram's Aura synthesis set. Also applied to Deepgram's speech-to-text
 * gate: the recognition API covers more languages, but reusing the narrower
 * synthesis list only costs an occasional pool skip, whereas widening STT on an
 * unverified list would send languages the account cannot bill.
 */
const DEEPGRAM_LANGUAGES: readonly string[] = [
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
];

/** Deepgram publishes Aura-2 voices for fewer languages than it recognises. */
const DEEPGRAM_TTS_LANGUAGES: readonly string[] = [
  "en",
  "es",
  "de",
  "fr",
  "nl",
  "it",
  "ja",
];

/**
 * The locales Edge actually publishes a Neural voice for, mirrored from
 * `EDGE_VOICES` in the worker. Asserted equal to that table's keys by
 * `edge.test.ts`, so the two cannot drift.
 *
 * This list is the `native` set, not the supported set. Edge's endpoint takes
 * any language, so the other 63 catalog languages stay reachable — a request
 * for a locale with no voice falls back to `en-US-AvaMultilingualNeural` /
 * `en-US-AndrewMultilingualNeural`. That fallback is a genuine answer, so those
 * languages are kept selectable and reported as `multilingual` rather than
 * being hidden or failing the gate.
 */
const EDGE_TTS_LANGUAGES: readonly string[] = [
  "af",
  "am",
  "ar",
  "az",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fa",
  "fi",
  "fr",
  "ga",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "is",
  "it",
  "ja",
  "jv",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "nb",
  "ne",
  "nl",
  "no",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "so",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "yue",
  "zh",
  "zu",
];

/**
 * The only language Wit's synthesis endpoint will speak natively.
 *
 * Wit resolves a TTS request's language from the API key, not the payload:
 * every one of the 130 non-English per-language keys answers
 * `400 {"code":"bad-request","error":"Unsupported language for synthesize"}`,
 * so they are unusable for speech. `WIT_KEY_EN` is the one key that
 * synthesizes, and the rest of the set is reached from it by switching the
 * request's language instead of its key.
 */
const WIT_TTS_NATIVE_LANGUAGES: readonly string[] = ["en"];

/** Deepgram Flux `general-multi`, the ten languages one model covers. */
const FLUX_MULTI_LANGUAGES: readonly string[] = [
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "nl",
  "pt",
  "ru",
];

/** AssemblyAI `u3-rt-pro` streaming: multilingual code-switching, six. */
const ASSEMBLYAI_U3_RT_PRO_LANGUAGES: readonly string[] = [
  "de",
  "en",
  "es",
  "fr",
  "it",
  "pt",
];

/** Gladia `solaria-1` on `/v2/live`, probed 2026-09-27. */
const GLADIA_STREAM_LANGUAGES: readonly string[] = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "ba",
  "be",
  "bg",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fo",
  "fr",
  "gl",
  "gu",
  "ha",
  "haw",
  "he",
  "hi",
  "hr",
  "ht",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "jv",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "la",
  "lb",
  "ln",
  "lo",
  "lt",
  "lv",
  "mg",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "nb",
  "ne",
  "nl",
  "no",
  "nn",
  "oc",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sa",
  "sd",
  "si",
  "sk",
  "sl",
  "sn",
  "so",
  "sq",
  "sr",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tk",
  "tg",
  "tl",
  "tr",
  "tt",
  "uk",
  "ur",
  "uz",
  "vi",
  "yo",
  "yi",
  "zh",
];

const whisper = (): LanguageCapabilitySpec => ({
  codes: WHISPER_LANGUAGES,
  aliases: WHISPER_ALIASES,
});

/**
 * ElevenLabs Scribe v2. It accepts ISO 639-1 or 639-3, but the published
 * language table is spelled in 639-3, so every call sends that form: a code
 * with no 639-1 equivalent (Cantonese `yue`) or a different one (Filipino
 * `fil`, or `zho` for our `zh`) stays unambiguous. Only languages our catalog
 * and Scribe both carry are listed.
 */
const SCRIBE_LANGUAGES: readonly string[] = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fa",
  "ff",
  "fi",
  "fr",
  "ga",
  "gl",
  "gu",
  "ha",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "ig",
  "is",
  "it",
  "ja",
  "jv",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "ku",
  "ky",
  "lb",
  "lg",
  "ln",
  "lo",
  "lt",
  "lv",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "nb",
  "ne",
  "nl",
  "no",
  "ny",
  "oc",
  "or",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sd",
  "si",
  "sk",
  "sl",
  "sn",
  "so",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "wo",
  "xh",
  "yo",
  "yue",
  "zh",
  "zu",
];

const SCRIBE_ALIASES: Readonly<Record<string, string>> = {
  af: "afr",
  am: "amh",
  ar: "ara",
  as: "asm",
  az: "aze",
  be: "bel",
  bg: "bul",
  bn: "ben",
  bs: "bos",
  ca: "cat",
  cs: "ces",
  cy: "cym",
  da: "dan",
  de: "deu",
  el: "ell",
  en: "eng",
  es: "spa",
  et: "est",
  fa: "fas",
  ff: "ful",
  fi: "fin",
  fr: "fra",
  ga: "gle",
  gl: "glg",
  gu: "guj",
  ha: "hau",
  he: "heb",
  hi: "hin",
  hr: "hrv",
  hu: "hun",
  hy: "hye",
  id: "ind",
  ig: "ibo",
  is: "isl",
  it: "ita",
  ja: "jpn",
  jv: "jav",
  ka: "kat",
  kk: "kaz",
  km: "khm",
  kn: "kan",
  ko: "kor",
  ku: "kur",
  ky: "kir",
  lb: "ltz",
  lg: "lug",
  ln: "lin",
  lo: "lao",
  lt: "lit",
  lv: "lav",
  mi: "mri",
  mk: "mkd",
  ml: "mal",
  mn: "mon",
  mr: "mar",
  ms: "msa",
  mt: "mlt",
  my: "mya",
  nb: "nor",
  ne: "nep",
  nl: "nld",
  no: "nor",
  ny: "nya",
  oc: "oci",
  or: "ori",
  pa: "pan",
  pl: "pol",
  ps: "pus",
  pt: "por",
  ro: "ron",
  ru: "rus",
  sd: "snd",
  si: "sin",
  sk: "slk",
  sl: "slv",
  sn: "sna",
  so: "som",
  sr: "srp",
  sv: "swe",
  sw: "swa",
  ta: "tam",
  te: "tel",
  tg: "tgk",
  th: "tha",
  tl: "fil",
  tr: "tur",
  uk: "ukr",
  ur: "urd",
  uz: "uzb",
  vi: "vie",
  wo: "wol",
  xh: "xho",
  yo: "yor",
  yue: "yue",
  zh: "zho",
  zu: "zul",
};

const scribe = (): LanguageCapabilitySpec => ({
  codes: SCRIBE_LANGUAGES,
  aliases: SCRIBE_ALIASES,
});

/**
 * ElevenLabs Flash v2.5: the 29 languages of Multilingual v2 plus Hungarian,
 * Norwegian and Vietnamese. Enumerated because the set is published and closed
 * — and because it excludes every Nigerian language, which is the whole reason
 * this cannot be `unbounded()`.
 */
const FLASH_TTS_LANGUAGES: readonly string[] = [
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sv",
  "ta",
  "tl",
  "tr",
  "uk",
  "vi",
  "zh",
];

/**
 * An upstream engine that accepts any language and is sent no language
 * selector. Spelled out per capability so it is never confused with a provider
 * that enumerates nothing.
 */
const unbounded = (): LanguageCapabilitySpec => ({
  codes: [],
  unbounded: true,
});

/**
 * What a route needs wrapped around our PCM16 LE 16 kHz mono. `wav_pcm` is one
 * RIFF header then raw samples, for Wit's header-rejecting dictation endpoint.
 */
export type WireFormat = "pcm_s16le" | "wav_pcm";

/**
 * One streaming speech-to-text target: a provider, the model it is asked to run,
 * and what routing needs to know about that pairing. Keyed on the model because
 * Deepgram's two differ: `flux-general-multi` covers ten languages and reports
 * a detected language per turn, `nova-3` covers thirty-three and does not.
 */
export interface StreamRoute {
  /** Stable across renames of the model, so it is safe in logs and events. */
  readonly id: string;
  readonly provider: ProviderId;
  readonly model: string;
  /** Lower wins, but only among routes covering the requested language. */
  readonly priority: number;
  /** Canonical codes, canonical spelling. Provider spelling lives in aliases. */
  readonly codes: readonly string[];
  readonly aliases?: Readonly<Record<string, string>>;
  /** Whether the route can detect the language when we do not supply one. */
  readonly autoDetect: boolean;
  /** Reports the detected language incrementally rather than only at the end. */
  readonly reportsLanguage: boolean;
  /** Handles a speaker switching language mid-utterance without a new session. */
  readonly codeSwitch: boolean;
  /** False for a plain HTTP pipe, which cannot be sent turn control. */
  readonly websocket: boolean;
  readonly wire: WireFormat;
  readonly timeoutMs: { free: number; premium: number };
}

/**
 * The streaming pipeline, in preference order: Flux for model-integrated turn
 * detection and per-turn language, u3-rt-pro for accuracy, Nova-3 for the
 * twenty-three languages Flux lacks, Gladia for auto-detection of the rest, and
 * Wit last as the widest set and the only route without turn control.
 */
export const STREAM_ROUTES: readonly StreamRoute[] = [
  {
    id: "deepgram-flux-multi",
    provider: "deepgram",
    model: "flux-general-multi",
    priority: 10,
    codes: FLUX_MULTI_LANGUAGES,
    autoDetect: true,
    reportsLanguage: true,
    codeSwitch: true,
    websocket: true,
    wire: "pcm_s16le",
    timeoutMs: { free: 12_000, premium: 5_000 },
  },
  {
    id: "assemblyai-u3-rt-pro",
    provider: "assemblyai",
    model: "u3-rt-pro",
    priority: 20,
    codes: ASSEMBLYAI_U3_RT_PRO_LANGUAGES,
    autoDetect: true,
    reportsLanguage: false,
    codeSwitch: true,
    websocket: true,
    wire: "pcm_s16le",
    timeoutMs: { free: 15_000, premium: 8_000 },
  },
  {
    id: "deepgram-nova-3",
    provider: "deepgram",
    model: "nova-3",
    priority: 30,
    codes: DEEPGRAM_LANGUAGES,
    autoDetect: true,
    reportsLanguage: false,
    codeSwitch: false,
    websocket: true,
    wire: "pcm_s16le",
    timeoutMs: { free: 8_000, premium: 5_000 },
  },
  {
    id: "gladia-solaria",
    provider: "gladia",
    model: "solaria-1",
    priority: 40,
    codes: GLADIA_STREAM_LANGUAGES,
    // Gladia speaks the Whisper spelling: `jw` for our `jv`, `no` for `nb`.
    // Probed, not assumed — `/v2/live` returns 400 for `jv` and 201 for `jw`.
    aliases: WHISPER_ALIASES,
    autoDetect: true,
    reportsLanguage: true,
    codeSwitch: true,
    websocket: true,
    wire: "pcm_s16le",
    timeoutMs: { free: 12_000, premium: 8_000 },
  },
  {
    id: "witai",
    provider: "witai",
    model: "wit-dictation",
    priority: 90,
    codes: WIT_STT_LANGUAGES,
    // One key per language, so the endpoint cannot be asked to detect anything.
    autoDetect: false,
    reportsLanguage: false,
    codeSwitch: false,
    // A chunked HTTP request, not a socket. No turn control, no silence events.
    websocket: false,
    wire: "wav_pcm",
    timeoutMs: { free: 15_000, premium: 10_000 },
  },
];

export const STREAM_ROUTE_IDS = STREAM_ROUTES.map((r) => r.id);

const ROUTE_BY_ID: ReadonlyMap<string, StreamRoute> = new Map(
  STREAM_ROUTES.map((r) => [r.id, r]),
);

const STREAM_ROUTES_BY_PRIORITY: readonly StreamRoute[] = [...STREAM_ROUTES]
  .filter((r, i, all) => all.findIndex((o) => o.priority === r.priority) === i)
  .sort((a, b) => a.priority - b.priority);

export const streamRouteById = (id: string): StreamRoute | undefined =>
  ROUTE_BY_ID.get(id);

/** Candidate routes for a language, best first. `auto` needs self-detection. */
export const streamRoutesFor = (lang: string): readonly StreamRoute[] => {
  if (!lang || lang === "auto") {
    return STREAM_ROUTES_BY_PRIORITY.filter((r) => r.autoDetect);
  }
  return STREAM_ROUTES_BY_PRIORITY.filter((r) => r.codes.includes(lang));
};

/** Every language the streaming pipeline can be asked for explicitly. */
export const streamLanguages = (): string[] =>
  [...new Set(STREAM_ROUTES.flatMap((r) => r.codes))].sort();

/** Every language the streaming pipeline can work out on its own. */
export const autoDetectLanguages = (): string[] =>
  [
    ...new Set(
      STREAM_ROUTES.filter((r) => r.autoDetect).flatMap((r) => r.codes),
    ),
  ].sort();

/** Streaming languages a picker must hide, because nothing can route them. */
export const unsupportedStreamLanguages = (): string[] => {
  const covered = new Set(streamLanguages());
  // Scoped to the offered set: a picker only needs to hide among the languages
  // it is actually showing, and returning the whole unsupported catalog would
  // imply the other 108 are merely unstreamable rather than not offered.
  return [...SUPPORTED_LANGUAGE_CODE_SET].filter((c) => !covered.has(c)).sort();
};

/**
 * Whether a stream route can handle this language, and if not, why.
 *
 * `auto` is answered by whether any route can detect. A concrete code is
 * answered by whether any route lists it. Both reduce to a question about
 * `STREAM_ROUTES`, so the batch, streaming and translate pipelines cannot drift
 * apart the way three hand-maintained tables did.
 */
export const streamSkipReason = (
  lang: string,
): "language" | "auto-detect" | null => {
  if (!lang || lang === "auto") {
    return streamRoutesFor("auto").length > 0 ? null : "auto-detect";
  }
  return streamRoutesFor(lang).length > 0 ? null : "language";
};

/**
 * First report wins, and a committed language is final.
 *
 * `auto` means nobody has claimed a language yet, which is the only value that
 * reads as "unresolved" — an empty string is a provider saying "I could not
 * tell" and must not overwrite a real answer.
 *
 * `committed` closes the door deliberately. Once a final transcript has been
 * shown to the user, the text is attributed to a language; changing that
 * retroactively would corrupt the translation and the history row. A provider
 * that disagrees afterwards is wrong about one turn, not about the session.
 */
export const pinLanguage = (
  pinned: string | null,
  reported: string | null | undefined,
  committed: boolean,
): string | null => {
  if (pinned) return pinned;
  if (committed) return null;
  const next = reported?.trim();
  return next ? next : null;
};

export const LANGUAGE_CAPABILITIES: Readonly<
  Record<
    ProviderId,
    Readonly<Partial<Record<LanguageCapability, LanguageCapabilitySpec>>>
  >
> = {
  assemblyai: {
    stt: whisper(),
  },
  cloudflare: {
    stt: whisper(),
    ttt: unbounded(),
  },
  cohere: {
    stt: { codes: COHERE_LANGUAGES },
    // An LLM, like the four below it, so gating it to fourteen languages only
    // meant Cohere was skipped for languages nothing else was short on.
    ttt: unbounded(),
  },
  deepgram: {
    stt: { codes: DEEPGRAM_LANGUAGES },
    // Aura-2 is a native-voice model for these seven, so none of them are
    // cross-lingual here.
    tts: { codes: DEEPGRAM_TTS_LANGUAGES, native: DEEPGRAM_TTS_LANGUAGES },
  },
  // Edge accepts any locale, but only the listed ones are read by a voice
  // authored for that language. The rest are covered by the English
  // multilingual fallback, which is a real answer rather than a failure, so
  // they stay selectable and are simply reported as `multilingual`.
  edge: {
    tts: { codes: LANGUAGE_CODES, native: EDGE_TTS_LANGUAGES },
  },
  elevenlabs: {
    stt: scribe(),
    // Flash v2.5 speaks 32 languages and none of them are Nigerian, so this is
    // an enumerated set rather than unbounded. Yoruba and Igbo have no native
    // voice here, and claiming them would route a user to audio that cannot say
    // their language. (STT is the reverse: Scribe covers yo and ig.)
    tts: { codes: FLASH_TTS_LANGUAGES },
  },
  gemini: {
    // Gemini takes no language on its speech request at all, so every language
    // it is asked for is by definition cross-lingual.
    tts: unbounded(),
    ttt: unbounded(),
  },
  gladia: {
    stt: whisper(),
  },
  groq: {
    stt: whisper(),
    ttt: unbounded(),
  },
  mistral: {
    ttt: unbounded(),
  },
  openrouter: {
    ttt: unbounded(),
  },
  witai: {
    // Dictation only, which is a strict subset of what Wit synthesizes. Using
    // the wide list here sent every Yoruba or Igbo request to a provider that
    // answers 400 for it, and Wit leads both STT pools — so the miss cost a
    // failed round-trip before the pool moved on.
    stt: { codes: WIT_STT_LANGUAGES },
    tts: { codes: WIT_LANGUAGES, native: WIT_TTS_NATIVE_LANGUAGES },
  },
};

const specFor = (
  provider: ProviderId,
  capability: LanguageCapability,
): LanguageCapabilitySpec | undefined =>
  LANGUAGE_CAPABILITIES[provider]?.[capability];

/**
 * Whether a provider both implements this capability and accepts this
 * canonical language for it.
 *
 * A provider with no entry for the capability answers false: a caller asking
 * this question is deciding whether to route work to that provider, and "we
 * never said it could translate" must not read as "yes, any language".
 */
export const isLanguageSupported = (
  provider: ProviderId,
  capability: LanguageCapability,
  code: string,
): boolean => {
  const spec = specFor(provider, capability);
  if (!spec) return false;
  if (spec.unbounded) return true;
  return spec.codes.includes(code);
};

/**
 * How well a provider can speak a language, or `null` when it cannot speak it
 * at all and must be skipped.
 *
 * This is the same decision {@link isLanguageSupported} makes, refined: a caller
 * that only needs to know whether to spend a request still asks that, while a
 * caller choosing between providers — or promising the user a voice — asks for
 * the tier. Keeping the unsupported case as `null` rather than a third tier
 * means the "can this run at all" question never has to be re-derived.
 */
export const languageTier = (
  provider: ProviderId,
  capability: LanguageCapability,
  code: string,
): LanguageTier | null => {
  const spec = specFor(provider, capability);
  if (!spec) return null;
  // No language reaches the engine, so nothing can be a native voice for it.
  if (spec.unbounded) return "multilingual";
  if (!spec.codes.includes(code)) return null;
  return spec.native?.includes(code) ? "native" : "multilingual";
};

/**
 * Whether any provider for this capability has a voice built for the language,
 * as opposed to merely being able to read it.
 */
export const hasNativeVoice = (
  capability: LanguageCapability,
  code: string,
): boolean =>
  (Object.keys(LANGUAGE_CAPABILITIES) as ProviderId[]).some(
    (id) => languageTier(id, capability, code) === "native",
  );

/**
 * The spelling to put on the wire for a provider, translating through that
 * capability's aliases. Returns the canonical code unchanged when the provider
 * uses our spelling, so callers can use it unconditionally.
 */
export const toProviderCode = (
  provider: ProviderId,
  capability: LanguageCapability,
  code: string,
): string => specFor(provider, capability)?.aliases?.[code] ?? code;

/**
 * Every canonical language with at least one *enumerated* provider for this
 * capability, sorted.
 *
 * A picker should offer exactly this set. It is a lower bound on what the
 * product can handle: an unbounded provider might cover a language not listed
 * here, so a caller that needs certainty should also consult
 * {@link isLanguageUnbounded}.
 */
export const languagesForCapability = (
  capability: LanguageCapability,
): string[] => {
  const union = new Set<string>();
  for (const spec of allSpecs(capability)) {
    for (const code of spec.codes) union.add(code);
  }
  return [...union].sort();
};

/** Whether any provider for this capability is language-agnostic. */
export const isLanguageUnbounded = (capability: LanguageCapability): boolean =>
  allSpecs(capability).some((spec) => spec.unbounded === true);

/** Provider ids that declare this capability, in registry order. */
export const providerIdsForCapability = (
  capability: LanguageCapability,
): ProviderId[] =>
  (Object.keys(LANGUAGE_CAPABILITIES) as ProviderId[]).filter(
    (id) => specFor(id, capability) !== undefined,
  );

/**
 * Canonical codes that no provider can handle for a capability, given the
 * enumerated sets. A picker should hide these.
 *
 * Empty whenever any provider is unbounded, because then nothing is provably
 * unsupported.
 */
export const unsupportedLanguages = (
  capability: LanguageCapability,
): string[] => {
  if (isLanguageUnbounded(capability)) return [];
  const covered = new Set(languagesForCapability(capability));
  // Offered set, not the whole catalog — see unsupportedStreamLanguages.
  return [...SUPPORTED_LANGUAGE_CODE_SET].filter((c) => !covered.has(c)).sort();
};

function allSpecs(capability: LanguageCapability): LanguageCapabilitySpec[] {
  return (Object.keys(LANGUAGE_CAPABILITIES) as ProviderId[])
    .map((id) => specFor(id, capability))
    .filter((spec): spec is LanguageCapabilitySpec => spec !== undefined);
}

export { isLanguageSupported as supportsLanguage };
