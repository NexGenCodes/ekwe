import { logger } from "./logger";
import { AiBinding } from "./types";

const AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const AI_TIMEOUT_MS = 3_000;
const CACHE_TTL = 86_400 * 30;
const MAX_CHARS = 2_000;

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function cacheKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `lang:${(hash >>> 0).toString(36)}`;
}

function isIsoCode(s: string): boolean {
  return /^[a-z]{2}$/.test(s);
}

function detectWithUnicode(text: string): string {
  if (!text.trim()) return "en";

  // Count characters by script ranges
  let cjk = 0, cyrillic = 0, arabic = 0, devanagari = 0, latin = 0, total = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    total++;
    if (code >= 0x4E00 && code <= 0x9FFF) cjk++;
    else if (code >= 0x3040 && code <= 0x30FF) cjk++;
    else if (code >= 0xAC00 && code <= 0xD7AF) cjk++;
    else if (code >= 0x0400 && code <= 0x04FF) cyrillic++;
    else if (code >= 0x0600 && code <= 0x06FF) arabic++;
    else if (code >= 0x0900 && code <= 0x097F) devanagari++;
    else if (
      (code >= 0x0041 && code <= 0x005A) ||
      (code >= 0x0061 && code <= 0x007A) ||
      (code >= 0x00C0 && code <= 0x024F)
    ) latin++;
  }

  if (total === 0) return "en";

  const cjkPct = cjk / total;
  const cyrillicPct = cyrillic / total;
  const arabicPct = arabic / total;
  const devanagariPct = devanagari / total;

  if (cjkPct > 0.5) return "zh";
  if (cyrillicPct > 0.5) return "ru";
  if (arabicPct > 0.5) return "ar";
  if (devanagariPct > 0.5) return "hi";
  return "en";
}

async function detectWithAI(
  text: string,
  ai: AiBinding,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  const onParentAbort = (): void => {
    clearTimeout(timer);
    controller.abort();
  };
  if (!signal.aborted)
    signal.addEventListener("abort", onParentAbort, { once: true });

  try {
    const result = await ai.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Detect the language of the user's text. Reply with ONLY the ISO 639-1 two-letter code (en, fr, es, de, pt, it, nl, ru, zh, ja, ko, ar, hi, etc.). No explanation, no punctuation, just the code.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 5,
      temperature: 0,
    });

    if (signal.aborted) return null;

    const lang = (result as { response?: string }).response
      ?.trim()
      .toLowerCase()
      .slice(0, 2);

    if (lang && isIsoCode(lang)) {
      return lang;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
  }
}

export async function detectTextLanguage(
  text: string,
  ai: AiBinding,
  kv: KvLike,
  signal: AbortSignal,
): Promise<string> {
  if (!text?.trim()) return "en";

  const input = text.slice(0, MAX_CHARS);

  // 1. KV cache hit
  const key = cacheKey(input);
  let fromCache: string | null = null;
  try {
    fromCache = await kv.get(key);
  } catch {
    /* carry on */
  }
  if (fromCache && isIsoCode(fromCache)) {
    return fromCache;
  }

  // 2. AI detection (with timeout)
  const aiLang = await detectWithAI(input, ai, signal);
  if (aiLang) {
    try {
      await kv.put(key, aiLang, { expirationTtl: CACHE_TTL });
    } catch {
      /* non-fatal */
    }
    return aiLang;
  }

  // 3. Unicode-range fallback
  return detectWithUnicode(text);
}
