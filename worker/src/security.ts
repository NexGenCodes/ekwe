import { Tier } from './types';
import { logger } from './logger';

/**
 * ─── Ekwe Worker Security Module ──────────────────────────────────
 *
 * Single source of truth for ALL tier-based enforcement limits.
 * Every route handler imports from here instead of hardcoding values.
 *
 * If a malicious user tampers with the frontend (e.g. flipping isPro
 * in MMKV), these limits still apply because the Worker derives the
 * tier from the cryptographically signed Supabase JWT — not from
 * any client-supplied flag.
 *
 * ── Enforcement Layers ──
 *   1. Rate Limiter      → Cloudflare binding (index.ts)
 *   2. Preflight Check   → Atomic cooldown via Supabase RPC (index.ts)
 *   3. Payload Guards     → This file (called by transcribe/translate)
 *   4. Postflight         → Background deduction (index.ts)
 */

// ─── Tier Limits (mirrors frontend PLAN_LIMITS for backend enforcement) ──

const TIER_LIMITS = {
  FREE: {
    maxTextChars: 3_000,          // ~500 words
    maxAudioBytes: 4 * 1024 * 1024,  // 4MB (~60s)
    autoDetectAllowed: false,
  },
  PREMIUM: {
    maxTextChars: 10_000,         // ~1,500 words
    maxAudioBytes: 10 * 1024 * 1024, // 10MB (~120s)
    autoDetectAllowed: true,
  },
  // CAPPED_PREMIUM users are silently downgraded
  CAPPED_PREMIUM: {
    maxTextChars: 5_000,
    maxAudioBytes: 6 * 1024 * 1024,  // 6MB (~72s)
    autoDetectAllowed: true,
  },
} as const;

type LimitsFor = (typeof TIER_LIMITS)[Tier];

function getLimits(tier: Tier): LimitsFor {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.FREE;
}

// ─── Valid Language Codes (allowlist) ─────────────────────────────
// Derived from the frontend LANGUAGES constant. Any code not in this
// set is rejected before it reaches an LLM provider.

const VALID_LANG_CODES = new Set([
  'auto',
  'en', 'es', 'it', 'de', 'zh', 'fr', 'pt', 'ru', 'ja', 'ko',
  'ar', 'hi', 'nl', 'pl', 'tr', 'sv', 'da', 'fi', 'nb', 'cs',
  'sk', 'ro', 'hu', 'uk', 'el', 'he', 'th', 'vi', 'id', 'ms',
  'bg', 'hr', 'sr', 'ca', 'lt', 'lv', 'et', 'sl', 'sq', 'mk',
  'af', 'bn', 'fa', 'ur', 'sw', 'tl', 'ta', 'te', 'ml', 'mr',
  'gu', 'pa', 'ne', 'si', 'km', 'lo', 'my', 'ka', 'yo', 'ig',
  'ha', 'zu', 'so', 'am', 'az', 'uz', 'kk', 'mn', 'hy', 'jv',
  'su', 'bs', 'is', 'ga', 'cy', 'gd', 'gl', 'eu', 'mt', 'xh',
  'sn', 'st', 'ny', 'rw', 'mg', 'tk', 'ky', 'tg', 'ps', 'sd',
  'mni', 'as', 'or',
]);

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
  de: 'German',
  zh: 'Chinese (Simplified)',
  fr: 'French',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  nb: 'Norwegian',
  cs: 'Czech',
  sk: 'Slovak',
  ro: 'Romanian',
  hu: 'Hungarian',
  uk: 'Ukrainian',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  bg: 'Bulgarian',
  hr: 'Croatian',
  sr: 'Serbian',
  ca: 'Catalan',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  sl: 'Slovenian',
  sq: 'Albanian',
  mk: 'Macedonian',
  af: 'Afrikaans',
  bn: 'Bengali',
  fa: 'Persian',
  ur: 'Urdu',
  sw: 'Swahili',
  tl: 'Filipino',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ne: 'Nepali',
  si: 'Sinhala',
  km: 'Khmer',
  lo: 'Lao',
  my: 'Burmese',
  ka: 'Georgian',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  zu: 'Zulu',
  so: 'Somali',
  am: 'Amharic',
  az: 'Azerbaijani',
  uz: 'Uzbek',
  kk: 'Kazakh',
  mn: 'Mongolian',
  hy: 'Armenian',
  jv: 'Javanese',
  su: 'Sundanese',
  bs: 'Bosnian',
  is: 'Icelandic',
  ga: 'Irish',
  cy: 'Welsh',
  gd: 'Scottish Gaelic',
  gl: 'Galician',
  eu: 'Basque',
  mt: 'Maltese',
  xh: 'Xhosa',
  sn: 'Shona',
  st: 'Sesotho',
  ny: 'Chichewa',
  rw: 'Kinyarwanda',
  mg: 'Malagasy',
  tk: 'Turkmen',
  ky: 'Kyrgyz',
  tg: 'Tajik',
  ps: 'Pashto',
  sd: 'Sindhi',
  mni: 'Meiteilon (Manipuri)',
  as: 'Assamese',
  or: 'Odia',
};

/**
 * Resolves a language code into its descriptive English name.
 * Used to provide context to LLM translation prompts.
 */
export function getLanguageName(code: string | undefined | null): string {
  if (!code || code === 'auto') return 'auto-detected language';
  return LANGUAGE_NAMES[code] ?? code;
}

// ─── Prompt Injection Patterns ───────────────────────────────────
// Common prompt injection markers that attempt to override LLM system prompts.
// These are stripped silently — the user still gets a translation, just without
// the injected payload.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /you\s+are\s+(now|a|an)\s+/gi,
  /act\s+as\s+(a|an)\s+/gi,
  /pretend\s+(you('re|\s+are)\s+)/gi,
  /system\s*prompt/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
];

// ─── Guard Results ───────────────────────────────────────────────

interface GuardPass { allowed: true }
interface GuardFail { allowed: false; response: Response }
type GuardResult = GuardPass | GuardFail;

// ─── Reusable Guard Functions ────────────────────────────────────

/**
 * Validates that the request Content-Type matches what the route expects.
 * Prevents malformed payloads from causing unhandled exceptions.
 * Used by: index.ts (before routing)
 */
export function guardContentType(
  request: Request,
  expected: 'json' | 'multipart',
): GuardResult {
  const ct = request.headers.get('Content-Type') || '';
  const valid = expected === 'json'
    ? ct.includes('application/json')
    : ct.includes('multipart/form-data');

  if (!valid) {
    logger.warn(`[security] Invalid Content-Type: "${ct}", expected: ${expected}`);
    return {
      allowed: false,
      response: Response.json(
        { error: 'INVALID_CONTENT_TYPE', message: `Expected ${expected === 'json' ? 'application/json' : 'multipart/form-data'}` },
        { status: 415 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Safely parses JSON from a request body.
 * Returns the parsed body or a 400 response on malformed input.
 * Used by: /translate
 */
export async function safeParseJSON<T>(request: Request): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  try {
    const data = (await request.json()) as T;
    return { ok: true, data };
  } catch {
    logger.warn('[security] Malformed JSON in request body');
    return {
      ok: false,
      response: Response.json(
        { error: 'INVALID_JSON', message: 'Request body is not valid JSON.' },
        { status: 400 },
      ),
    };
  }
}

/**
 * Rejects text payloads that exceed the tier's character limit.
 * Used by: /translate
 */
export function guardTextLength(text: string, tier: Tier): GuardResult {
  const { maxTextChars } = getLimits(tier);

  if (text.length > maxTextChars) {
    logger.warn(`[security] Rejected text for tier ${tier}. Length: ${text.length} > Max: ${maxTextChars}`);
    return {
      allowed: false,
      response: Response.json(
        { error: 'TEXT_TOO_LONG', message: `Text exceeds the ${maxTextChars} character limit.` },
        { status: 413 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Rejects audio files that exceed the tier's byte-size limit.
 * Used by: /transcribe
 */
export function guardAudioSize(fileSize: number, tier: Tier): GuardResult {
  const { maxAudioBytes } = getLimits(tier);

  if (fileSize > maxAudioBytes) {
    logger.warn(`[security] Rejected audio for tier ${tier}. Size: ${fileSize} > Max: ${maxAudioBytes}`);
    return {
      allowed: false,
      response: Response.json(
        { error: 'FILE_TOO_LARGE', message: `Audio file exceeds the ${Math.round(maxAudioBytes / 1024 / 1024)}MB limit for your plan.` },
        { status: 413 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Rejects auto-detect language requests from non-Pro users.
 * Used by: /transcribe AND /translate
 */
export function guardAutoDetect(lang: string | undefined | null, tier: Tier): GuardResult {
  const { autoDetectAllowed } = getLimits(tier);
  const isAuto = !lang || lang === 'auto';

  if (isAuto && !autoDetectAllowed) {
    logger.warn(`[security] Rejected auto-detect for tier ${tier}`);
    return {
      allowed: false,
      response: Response.json(
        { error: 'AUTO_DETECT_PRO_ONLY', message: 'Auto-detect language is a Pro feature.' },
        { status: 403 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Validates that a language code is in the known allowlist.
 * Prevents unknown codes from reaching LLM providers (which could
 * cause unexpected behavior or token waste).
 * Used by: /translate AND /transcribe
 */
export function guardLanguageCode(code: string | undefined | null, fieldName: string): GuardResult {
  // undefined/null are valid (means "not specified" or "auto")
  if (!code) return { allowed: true };

  if (!VALID_LANG_CODES.has(code)) {
    logger.warn(`[security] Invalid language code: "${code}" for field: ${fieldName}`);
    return {
      allowed: false,
      response: Response.json(
        { error: 'INVALID_LANGUAGE', message: `Unsupported language code: ${code}` },
        { status: 400 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Strips common prompt injection patterns from user text.
 * Does NOT reject — silently removes the injection markers so the
 * user still gets a valid translation minus the attack payload.
 * Used by: /translate (before sending to LLM)
 */
export function sanitizeTranslationText(text: string): string {
  let sanitized = text;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  // Collapse excessive whitespace left by removals
  return sanitized.replace(/\s{3,}/g, '  ').trim();
}
