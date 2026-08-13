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

export function buildTranslatePrompt(
  targetLang: string,
  sourceLang?: string,
): string {
  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceLang ? ` from ${sourceLang}` : ""} into fluent, natural-sounding ${targetLang}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
4. Output ONLY the final translated text and nothing else.`;
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
