import { franc } from 'franc';

const CACHE_TTL = 86_400 * 30;
const MAX_CHARS = 2_000;
const SHORT_TEXT_THRESHOLD = 10;

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const ISO639_3_TO_1: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt',
  nld: 'nl', rus: 'ru', cmn: 'zh', jpn: 'ja', kor: 'ko', arb: 'ar',
  ara: 'ar', hin: 'hi', ell: 'el', vie: 'vi', tha: 'th', heb: 'he',
  tur: 'tr', pol: 'pl', swe: 'sv', dan: 'da', fin: 'fi', nob: 'nb',
  ces: 'cs', slk: 'sk', ron: 'ro', hun: 'hu', ukr: 'uk', ind: 'id',
  msa: 'ms', bul: 'bg', hrv: 'hr', srp: 'sr', cat: 'ca', lit: 'lt',
  lav: 'lv', est: 'et', slv: 'sl', sqi: 'sq', mkd: 'mk', afr: 'af',
  ben: 'bn', fas: 'fa', urd: 'ur', swa: 'sw', tgl: 'tl', tam: 'ta',
  tel: 'te', mal: 'ml', mar: 'mr', guj: 'gu', pan: 'pa', nep: 'ne',
  sin: 'si', khm: 'km', lao: 'lo', mya: 'my', kat: 'ka', yor: 'yo',
  ibo: 'ig', hau: 'ha', zul: 'zu', som: 'so', amh: 'am', aze: 'az',
  uzb: 'uz', kaz: 'kk', mon: 'mn', hye: 'hy', jav: 'jv', sun: 'su',
  bos: 'bs', isl: 'is', gle: 'ga', cym: 'cy', gla: 'gd', glg: 'gl',
  eus: 'eu', mlt: 'mt', xho: 'xh', sna: 'sn', sot: 'st', nya: 'ny',
  kin: 'rw', mlg: 'mg', tuk: 'tk', kir: 'ky', tgk: 'tg', pus: 'ps',
  snd: 'sd', mni: 'mni', asm: 'as', ori: 'or',
  nds: 'de', gmh: 'de', gsw: 'de', yue: 'zh', nan: 'zh', wuu: 'zh',
};

function iso6393to1(code: string): string | undefined {
  return ISO639_3_TO_1[code];
}

function detectWithUnicode(text: string): string {
  if (!text.trim()) return 'en';

  let cjk = 0, cyrillic = 0, arabic = 0, devanagari = 0, total = 0;

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
  }

  if (total === 0) return 'en';

  const cjkPct = cjk / total;
  const cyrillicPct = cyrillic / total;
  const arabicPct = arabic / total;
  const devanagariPct = devanagari / total;

  if (cjkPct > 0.5) return 'zh';
  if (cyrillicPct > 0.5) return 'ru';
  if (arabicPct > 0.5) return 'ar';
  if (devanagariPct > 0.5) return 'hi';
  return 'en';
}

export async function detectTextLanguage(
  text: string,
  _ai: unknown,
  kv: KvLike,
  signal: AbortSignal,
): Promise<string> {
  if (!text?.trim()) return 'en';

  const input = text.slice(0, MAX_CHARS);

  function cacheKey(s: string): string {
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
    }
    return `lang:${(hash >>> 0).toString(36)}`;
  }

  const key = cacheKey(input);
  let fromCache: string | null = null;
  try {
    fromCache = await kv.get(key);
  } catch { /* cache miss — continue with live detection */ }
  if (fromCache) return fromCache;

  if (signal.aborted) return 'en';

  let detected: string;

  if (input.length < SHORT_TEXT_THRESHOLD) {
    detected = detectWithUnicode(input);
  } else {
    try {
      const francResult = franc(input);
      detected = iso6393to1(francResult) || detectWithUnicode(input);
    } catch {
      detected = detectWithUnicode(input);
    }
  }

  try {
    await kv.put(key, detected, { expirationTtl: CACHE_TTL });
  } catch { /* cache write failure — non-critical, result still returned */ }

  return detected;
}
