const HALLUCINATION_PATTERNS: RegExp[] = [
  /^thanks?\s+(for\s+)?watching/i,
  /^thank\s+you\s+for\s+watching/i,
  /^(please\s+)?(subscribe|like\s+and\s+subscribe)/i,
  /^(music|applause|laughter|silence|blank audio)\s*\.?$/i,
  /^\[.*\]\s*$/,
  /^\.+$/,
  /^(you|he|she|they|we|i)\s*$/i,
  /^(the|a|an)\s*$/i,
];

// Max block length (chars) to consider when looking for repeated blocks. The
// old /(.{5,})\1{2,}/ backreference regex backtracks quadratically on large
// near-miss transcripts (32KB -> 65ms, 100KB -> 600ms). This scan is linear in
// the input (O(MAX_REPEATED_BLOCK * n)) and still covers any hallucination
// phrase realistically short enough to be repeated verbatim 3+ times.
const MAX_REPEATED_BLOCK = 64;

function hasRepeatedBlock(text: string): boolean {
  const n = text.length;
  if (n < 15) return false;

  // Frequency prefilter: 3 copies of a >=5-char block guarantee some character
  // appears at least 3 times. Skips the common near-miss case in one O(n) pass.
  const freqs = new Array<number>(65536).fill(0);
  let sawRepeat = false;
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    const f = ++freqs[code];
    if (f >= 3) {
      sawRepeat = true;
      break;
    }
  }
  if (!sawRepeat) return false;

  const maxBlock = Math.min(Math.floor(n / 3), MAX_REPEATED_BLOCK);
  for (let blockLen = 5; blockLen <= maxBlock; blockLen++) {
    let run = 0;
    for (let i = blockLen; i < n; i++) {
      if (text.charCodeAt(i) === text.charCodeAt(i - blockLen)) {
        run++;
        if (run >= blockLen * 2) return true;
      } else {
        run = 0;
      }
    }
  }
  return false;
}

const MAX_WORDS_PER_SECOND = 6;
const MIN_WORDS_PER_SECOND = 0.15;

/**
 * Delimiter between a translation and its romanized pronunciation guide.
 * `<|...|>` never appears in natural prose, so splitting on it is safe.
 */
export const ROMANIZATION_MARKER = "<|ekwe:romanization|>";

// Language codes whose primary script is NOT the Latin alphabet. Romanization
// (a Latin-script pronunciation guide) is only useful when translating INTO
// these languages — romanizing e.g. Yoruba or French is meaningless.
const NON_LATIN_SCRIPT_CODES = new Set([
  // CJK
  "zh",
  "yue",
  "ja",
  "ko",
  // Cyrillic
  "ru",
  "uk",
  "bg",
  "sr",
  "mk",
  // Greek / Hebrew
  "el",
  "he",
  "yi",
  // Arabic script
  "ar",
  "fa",
  "ur",
  "ug",
  // Devanagari family
  "hi",
  "mr",
  "ne",
  "ks",
  "bn",
  "pa",
  "gu",
  // South-Asian scripts
  "ta",
  "te",
  "ml",
  "si",
  // Southeast-Asian scripts
  "km",
  "lo",
  "my",
  "th",
  // Other scripts
  "ka",
  "am",
  "ti",
  "dv",
  "iu",
]);

/** Whether translating INTO `langCode` benefits from a romanization guide. */
export function needsRomanization(langCode: string): boolean {
  return NON_LATIN_SCRIPT_CODES.has(langCode);
}

/**
 * Splits a provider's raw translation output into translation + romanization.
 *
 * When `transliteration` was not requested, the raw text is returned as-is
 * (no parsing — the provider may legally return any prose). When requested,
 * we look for the marker: if the model declined to romanize (e.g. Latin-script
 * target, or it just ignored the instruction), fall back to the raw text so a
 * translation is never lost to a parsing failure.
 */
export function parseTranslateOutput(
  raw: string,
  transliteration: boolean | undefined,
): { translation: string; transliteration?: string } {
  const trimmed = raw.trim();
  if (!transliteration) return { translation: trimmed };

  const markerIndex = trimmed.lastIndexOf(ROMANIZATION_MARKER);
  if (markerIndex === -1) return { translation: trimmed };

  const translation = trimmed.slice(0, markerIndex).trim();
  const romanized = trimmed
    .slice(markerIndex + ROMANIZATION_MARKER.length)
    .trim();
  // Malformed output: never leak the marker into the visible translation.
  if (!translation) return { translation: trimmed };
  if (!romanized) return { translation };

  return { translation, transliteration: romanized };
}

export function buildTranslatePrompt(
  targetLang: string,
  sourceLang?: string,
  transliteration?: boolean,
): string {
  const outputRule = transliteration
    ? `4. Output the translation first, then — ONLY if the target script differs from the Latin alphabet — a blank line, then exactly the marker ${ROMANIZATION_MARKER}, then the romanized pronunciation guide in Latin letters, then nothing else.
5. The romanized guide must cover the full translation word-for-word and contain only Latin alphabet characters.
6. If the target language uses the Latin alphabet, output ONLY the translation (no marker).`
    : `4. Output ONLY the final translated text and nothing else.`;

  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceLang ? ` from ${sourceLang}` : ""} into fluent, natural-sounding ${targetLang}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
${outputRule}`;
}

export function isHallucination(text: string, durationMs?: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  if (hasRepeatedBlock(trimmed)) return true;

  if (durationMs && durationMs > 0) {
    const words = trimmed.split(/\s+/).filter((w) => w.length > 0).length;
    const durationSeconds = durationMs / 1000;
    const wps = words / durationSeconds;
    if (wps > MAX_WORDS_PER_SECOND) return true;
    if (words > 3 && wps < MIN_WORDS_PER_SECOND) return true;
  }

  return false;
}
