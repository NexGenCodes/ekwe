/**
 * Detects the ISO 639-1 language code of a given text string
 * using backend detection. Returns 'und' if detection fails.
 *
 * Extracted from TranscriptionService so both audio and
 * text share intent paths can reuse it.
 */

const ISO3_TO_ISO1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  ita: 'it',
  deu: 'de',
  zho: 'zh',
  fra: 'fr',
  por: 'pt',
  rus: 'ru',
  jpn: 'ja',
  kor: 'ko',
  ara: 'ar',
  hin: 'hi',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  swe: 'sv',
  dan: 'da',
  fin: 'fi',
  nor: 'nb',
  ces: 'cs',
  slk: 'sk',
  ron: 'ro',
  hun: 'hu',
  ukr: 'uk',
  ell: 'el',
  heb: 'he',
  tha: 'th',
  vie: 'vi',
  ind: 'id',
  msa: 'ms',
  bul: 'bg',
  hrv: 'hr',
  srp: 'sr',
  cat: 'ca',
  lit: 'lt',
  lav: 'lv',
  est: 'et',
  slv: 'sl',
  sqi: 'sq',
  mkd: 'mk',
  afr: 'af',
  ben: 'bn',
  fas: 'fa',
  urd: 'ur',
  swa: 'sw',
  fil: 'tl',
  tam: 'ta',
  tel: 'te',
  mal: 'ml',
  mar: 'mr',
  guj: 'gu',
  pan: 'pa',
  nep: 'ne',
  sin: 'si',
  khm: 'km',
  lao: 'lo',
  mya: 'my',
  kat: 'ka',
};

export const detectLanguage = (text: string): string => {
  // Offline language detection was removed to reduce bundle size.
  // Language detection now relies on backend STT APIs (Whisper/Deepgram).
  return 'und';
};
