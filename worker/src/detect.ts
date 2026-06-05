import { logger } from "./logger";
import { AiBinding } from "./types";
import { detectLanguage as detectUnicode } from "./utils";

const AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const AI_TIMEOUT_MS = 3_000;
const CACHE_TTL = 86_400 * 30;
const MAX_CHARS = 2_000;

interface KvLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
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

export async function detectLanguage(
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

  // 2. AI detection (with timeout fallback)
  const aiLang = await detectWithAI(input, ai, signal);
  if (aiLang) {
    try {
      await kv.put(key, aiLang, { expirationTtl: CACHE_TTL });
    } catch {
      /* non-fatal */
    }
    return aiLang;
  }

  // 3. Unicode fallback (instant)
  return detectUnicode(text);
}
