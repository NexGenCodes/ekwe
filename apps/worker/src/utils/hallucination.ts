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

const MAX_REPEATED_BLOCK = 64;

function hasRepeatedBlock(text: string): boolean {
  const n = text.length;
  if (n < 15) return false;

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
