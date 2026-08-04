import { francAll } from "franc";
import { logger } from "./logger";
import { hashKey } from "./utils/keys";

const CACHE_TTL = 86_400 * 30;
const MAX_CHARS = 2_000;
const SHORT_TEXT_THRESHOLD = 10;
const CONFIDENCE_GAP = 0.15;
const FRANC_MAX_CHARS = 200;

interface KvLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
}

const ISO639_3_TO_1: Record<string, string> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  ita: "it",
  por: "pt",
  nld: "nl",
  rus: "ru",
  cmn: "zh",
  jpn: "ja",
  kor: "ko",
  arb: "ar",
  ara: "ar",
  hin: "hi",
  ell: "el",
  vie: "vi",
  tha: "th",
  heb: "he",
  tur: "tr",
  pol: "pl",
  swe: "sv",
  dan: "da",
  fin: "fi",
  nob: "nb",
  ces: "cs",
  slk: "sk",
  ron: "ro",
  hun: "hu",
  ukr: "uk",
  ind: "id",
  msa: "ms",
  bul: "bg",
  hrv: "hr",
  srp: "sr",
  cat: "ca",
  lit: "lt",
  lav: "lv",
  est: "et",
  slv: "sl",
  sqi: "sq",
  mkd: "mk",
  afr: "af",
  ben: "bn",
  fas: "fa",
  urd: "ur",
  swa: "sw",
  tgl: "tl",
  tam: "ta",
  tel: "te",
  mal: "ml",
  mar: "mr",
  guj: "gu",
  pan: "pa",
  nep: "ne",
  sin: "si",
  khm: "km",
  lao: "lo",
  mya: "my",
  kat: "ka",
  yor: "yo",
  ibo: "ig",
  hau: "ha",
  zul: "zu",
  som: "so",
  amh: "am",
  aze: "az",
  uzb: "uz",
  kaz: "kk",
  mon: "mn",
  hye: "hy",
  jav: "jv",
  sun: "su",
  bos: "bs",
  isl: "is",
  gle: "ga",
  cym: "cy",
  gla: "gd",
  glg: "gl",
  eus: "eu",
  mlt: "mt",
  xho: "xh",
  sna: "sn",
  sot: "st",
  nya: "ny",
  kin: "rw",
  mlg: "mg",
  tuk: "tk",
  kir: "ky",
  tgk: "tg",
  pus: "ps",
  snd: "sd",
  asm: "as",
  ori: "or",
  nds: "de",
  gmh: "de",
  gsw: "de",
  yue: "zh",
  nan: "zh",
  wuu: "zh",
};

function iso6393to1(code: string): string | undefined {
  return ISO639_3_TO_1[code];
}

function normalizeLangCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] || "";
}

function detectWithUnicode(text: string): string {
  if (!text.trim()) return "en";

  let cjk = 0,
    kana = 0,
    cyrillic = 0,
    arabic = 0,
    devanagari = 0,
    hangul = 0,
    thai = 0,
    total = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    total++;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if (code >= 0x3040 && code <= 0x30ff) kana++;
    else if (code >= 0xac00 && code <= 0xd7af) hangul++;
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic++;
    else if (code >= 0x0600 && code <= 0x06ff) arabic++;
    else if (code >= 0x0900 && code <= 0x097f) devanagari++;
    else if (code >= 0x0e00 && code <= 0x0e7f) thai++;
  }

  if (total === 0) return "en";

  const cjkPct = (cjk + hangul) / total;
  const kanaPct = kana / total;
  const hangulPct = hangul / total;
  const cyrillicPct = cyrillic / total;
  const arabicPct = arabic / total;
  const devanagariPct = devanagari / total;
  const thaiPct = thai / total;

  if (hangulPct > 0.3) return "ko";
  if (thaiPct > 0.3) return "th";
  if (kanaPct > 0.3) return "ja";
  if (cjkPct > 0.5) return kanaPct > 0.02 ? "ja" : "zh";
  if (cyrillicPct > 0.5) return "ru";
  if (arabicPct > 0.5) return "ar";
  if (devanagariPct > 0.5) return "hi";
  return "en";
}

export async function detectTextLanguage(
  text: string,
  kv: KvLike,
  signal: AbortSignal,
): Promise<string> {
  if (!text?.trim()) return "en";

  const input = text.slice(0, MAX_CHARS);

  async function cacheKey(s: string): Promise<string> {
    return `lang:${await hashKey(s)}`;
  }

  const key = await cacheKey(input);
  let fromCache: string | null = null;
  try {
    fromCache = await kv.get(key);
  } catch {
    /* cache miss — continue with live detection */
  }
  if (fromCache) return fromCache;

  if (signal.aborted) return "en";

  let detected: string;

  if (input.length < SHORT_TEXT_THRESHOLD) {
    detected = detectWithUnicode(input);
  } else {
    try {
      const ranked = francAll(input);
      if (ranked.length === 0) {
        detected = detectWithUnicode(input);
      } else {
        const [topCode, topScore] = ranked[0];
        const secondScore = ranked.length > 1 ? ranked[1][1] : 0;
        const gap = topScore - secondScore;

        const francLang = iso6393to1(topCode);
        const unicodeLang = detectWithUnicode(input);

        if (francLang && gap >= CONFIDENCE_GAP) {
          detected = francLang;
        } else if (francLang && unicodeLang && francLang === unicodeLang) {
          detected = francLang;
        } else if (unicodeLang && unicodeLang !== "en") {
          detected = unicodeLang;
        } else if (francLang) {
          detected = francLang;
        } else {
          detected = "en";
        }
      }
    } catch {
      detected = detectWithUnicode(input);
    }
  }

  try {
    await kv.put(key, detected, { expirationTtl: CACHE_TTL });
  } catch {
    /* cache write failure — non-critical, result still returned */
  }

  return detected;
}

export function validateTranscriptLanguage(
  text: string,
  detectedLang: string | undefined,
): boolean {
  if (!text || !detectedLang || text.length < SHORT_TEXT_THRESHOLD) return true;

  try {
    const ranked = francAll(text.slice(0, FRANC_MAX_CHARS));
    if (ranked.length === 0) return true;

    const [topCode, topScore] = ranked[0];
    const secondScore = ranked.length > 1 ? ranked[1][1] : 0;
    const gap = topScore - secondScore;

    if (gap < CONFIDENCE_GAP) return true;

    const francLang = iso6393to1(topCode);
    if (!francLang) return true;

    const match = francLang === normalizeLangCode(detectedLang);
    if (!match) {
      logger.warn("[autoDetect] Transcript language mismatch", {
        provider: detectedLang,
        franc: francLang,
        gap,
        textSnippet: text.substring(0, 80),
      });
    }
    return match;
  } catch {
    return true;
  }
}
