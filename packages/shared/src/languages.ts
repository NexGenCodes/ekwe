import {
  languages as countryLanguages,
  type TCountryCode,
} from "countries-list";

export interface Language {
  code: string;
  englishName: string;
  nativeName: string;
}

export function languageName(code: string): string {
  return LANGUAGE_BY_CODE.get(code)?.englishName ?? code;
}

export function getLanguageName(code: string | undefined | null): string {
  if (!code || code === "auto") return "auto-detected language";
  return languageName(code);
}

const NAME_OVERRIDES: Record<
  string,
  { englishName: string; nativeName: string }
> = {
  zh: { englishName: "Chinese (Simplified)", nativeName: "中文" },
  haw: { englishName: "Hawaiian", nativeName: "ʻŌlelo Hawaiʻi" },
  ci: { englishName: "Cherokee", nativeName: "ᏣᎳᎩ" },
  ck: { englishName: "Sicilian", nativeName: "Sicilianu" },
  yue: { englishName: "Cantonese", nativeName: "粵語" },
};

/**
 * The canonical language catalog: every language the product knows about.
 *
 * These are always ISO 639-1-ish codes in *our* spelling, never a provider's.
 * A provider that spells something differently (Whisper's `jw` for our `jv`)
 * is expressed as an alias in languageCapabilities.ts, so this list stays the
 * one vocabulary that storage, UI, and the database all speak.
 */
export const LANGUAGE_CODES = [
  "en",
  "es",
  "it",
  "de",
  "zh",
  "fr",
  "pt",
  "ru",
  "ja",
  "ko",
  "ar",
  "hi",
  "nl",
  "pl",
  "tr",
  "sv",
  "da",
  "fi",
  "nb",
  "cs",
  "sk",
  "ro",
  "hu",
  "uk",
  "el",
  "he",
  "th",
  "vi",
  "id",
  "ms",
  "bg",
  "hr",
  "sr",
  "ca",
  "lt",
  "lv",
  "et",
  "sl",
  "sq",
  "mk",
  "af",
  "bn",
  "fa",
  "ur",
  "sw",
  "tl",
  "ta",
  "te",
  "ml",
  "mr",
  "gu",
  "pa",
  "ne",
  "si",
  "km",
  "lo",
  "my",
  "ka",
  "yo",
  "ig",
  "ha",
  "zu",
  "so",
  "am",
  "az",
  "uz",
  "kk",
  "mn",
  "hy",
  "jv",
  "su",
  "bs",
  "is",
  "ga",
  "cy",
  "gd",
  "gl",
  "eu",
  "mt",
  "xh",
  "sn",
  "st",
  "ny",
  "rw",
  "mg",
  "tk",
  "ky",
  "tg",
  "ps",
  "sd",
  "as",
  "or",
  "ba",
  "be",
  "bo",
  "br",
  "fo",
  "haw",
  "ht",
  "ci",
  "ck",
  "kn",
  "la",
  "lb",
  "ln",
  "mi",
  "nn",
  "oc",
  "sa",
  "tt",
  "yi",
  "yue",
  "ak",
  "ay",
  "dv",
  "eo",
  "ff",
  "fy",
  "gn",
  "iu",
  "kl",
  "ks",
  "ku",
  "lg",
  "li",
  "no",
  "nr",
  "om",
  "qu",
  "rm",
  "sc",
  "se",
  "ss",
  "ti",
  "tn",
  "ts",
  "ug",
  "ve",
  "wo",
] as const satisfies readonly string[];

/** Union of the canonical catalog, for narrowing a plain `string` code. */
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/**
 * The languages the product offers.
 *
 * This is the single editable list: every user-facing surface is derived from
 * it, so adding or removing a language here is the only edit needed to change
 * what appears in the picker, what the worker will accept, and what the
 * conformance tests assert.
 *
 * It is deliberately a *subset* rather than a replacement for
 * {@link LANGUAGE_CODES}. The catalog answers "what languages exist" and is
 * used to resolve names and decode stored preferences; the tier answers "what do
 * we offer". Collapsing them would strip the ability to name a language in a
 * historical record, and would hard-fail any user whose saved selection falls
 * outside the current set.
 *
 * Every language here was verified to have at least one transcription, one
 * synthesis and one translation provider in the *free* pool, so the offered
 * set never depends on a paid tier.
 */
export const SUPPORTED_LANGUAGE_CODES = [
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
] as const satisfies readonly LanguageCode[];

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export const SUPPORTED_LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(
  SUPPORTED_LANGUAGE_CODES,
);

/** Whether a code is one the product offers. */
export const isSupportedLanguage = (
  code: string | undefined | null,
): code is SupportedLanguageCode =>
  code != null && SUPPORTED_LANGUAGE_CODE_SET.has(code);

export const LANGUAGE_CODE_SET: ReadonlySet<string> = new Set(LANGUAGE_CODES);

/**
 * Every catalog language with its names resolved, offered or not.
 *
 * This is what name resolution must read. {@link LANGUAGES} is the offered tier,
 * so indexing names from it would make a provider reporting a language we have
 * dropped look like an unknown language — and `canonicalLanguageFromName` would
 * discard a perfectly good detection instead of reporting it.
 */
export const ALL_LANGUAGES: Language[] = LANGUAGE_CODES.map((code) => {
  const lib = countryLanguages[code as keyof typeof countryLanguages];
  const override = NAME_OVERRIDES[code];
  return {
    code,
    englishName: override?.englishName ?? lib?.name ?? code,
    nativeName: override?.nativeName ?? lib?.native ?? code,
  };
});

/** Catalog lookup that still resolves a language we no longer offer. */
export const LANGUAGE_BY_ANY_CODE: ReadonlyMap<string, Language> = new Map(
  ALL_LANGUAGES.map((l): [string, Language] => [l.code, l]),
);

/**
 * The offered languages, in catalog order.
 *
 * Every picker reads this rather than {@link LANGUAGE_CODES}: the catalog
 * exists so names and stored values still resolve for languages we once
 * supported, and reading it directly is how an unsupported language would leak
 * into the UI.
 */
export const LANGUAGES: Language[] = LANGUAGE_CODES.filter(
  isSupportedLanguage,
).map((code) => LANGUAGE_BY_ANY_CODE.get(code) as Language);

/**
 * Lookup by code that still resolves a language we no longer offer.
 *
 * Backs {@link languageName} and the display helpers: a stored selection, a
 * history row or a provider-reported detection must keep rendering a real name
 * after the language leaves the offered tier. Backing this from {@link LANGUAGES}
 * would silently downgrade those to the bare code.
 */
export const LANGUAGE_BY_CODE: ReadonlyMap<string, Language> =
  LANGUAGE_BY_ANY_CODE;

const LANG_TO_COUNTRY: Record<string, TCountryCode> = {
  en: "GB",
  es: "ES",
  it: "IT",
  de: "DE",
  zh: "CN",
  fr: "FR",
  pt: "PT",
  ru: "RU",
  ja: "JP",
  ko: "KR",
  ar: "SA",
  hi: "IN",
  nl: "NL",
  pl: "PL",
  tr: "TR",
  sv: "SE",
  da: "DK",
  fi: "FI",
  nb: "NO",
  cs: "CZ",
  sk: "SK",
  ro: "RO",
  hu: "HU",
  uk: "UA",
  el: "GR",
  he: "IL",
  th: "TH",
  vi: "VN",
  id: "ID",
  ms: "MY",
  bg: "BG",
  hr: "HR",
  sr: "RS",
  ca: "ES",
  lt: "LT",
  lv: "LV",
  et: "EE",
  sl: "SI",
  sq: "AL",
  mk: "MK",
  af: "ZA",
  bn: "BD",
  fa: "IR",
  ur: "PK",
  sw: "KE",
  tl: "PH",
  ta: "IN",
  te: "IN",
  ml: "IN",
  mr: "IN",
  gu: "IN",
  pa: "IN",
  ne: "NP",
  si: "LK",
  km: "KH",
  lo: "LA",
  my: "MM",
  ka: "GE",
  yo: "NG",
  ig: "NG",
  ha: "NG",
  zu: "ZA",
  so: "SO",
  am: "ET",
  az: "AZ",
  uz: "UZ",
  kk: "KZ",
  mn: "MN",
  hy: "AM",
  jv: "ID",
  su: "ID",
  bs: "BA",
  is: "IS",
  ga: "IE",
  gl: "ES",
  eu: "ES",
  mt: "MT",
  xh: "ZA",
  sn: "ZW",
  st: "LS",
  ny: "MW",
  rw: "RW",
  mg: "MG",
  tk: "TM",
  ky: "KG",
  tg: "TJ",
  ps: "AF",
  sd: "PK",
  as: "IN",
  or: "IN",
  ci: "US",
  ck: "IT",
  fo: "FO",
  fy: "NL",
  haw: "US",
  ht: "HT",
  iu: "CA",
  kl: "GL",
  lb: "LU",
  mi: "NZ",
  nn: "NO",
  no: "NO",
  oc: "FR",
  rm: "CH",
  sa: "IN",
  sc: "IT",
  se: "NO",
  ti: "ER",
  tt: "RU",
  yi: "IL",
  yue: "HK",
  ak: "GH",
  ay: "BO",
  ba: "RU",
  be: "BY",
  bo: "CN",
  br: "FR",
  dv: "MV",
  ff: "SN",
  gn: "PY",
  kn: "IN",
  ks: "IN",
  ku: "IQ",
  lg: "UG",
  li: "NL",
  ln: "CD",
  nr: "ZA",
  om: "ET",
  qu: "PE",
  ss: "SZ",
  tn: "BW",
  ts: "ZA",
  ug: "CN",
  ve: "ZA",
  wo: "SN",
};

/**
 * Languages written in a script a reader who does not know the language
 * cannot pronounce from the text alone. A transliteration is therefore worth
 * generating for these, and only these.
 *
 * This used to live in the worker's prompt builder, which meant the client
 * could not ask whether to offer a transliteration without duplicating the
 * list. It is a property of the language, not of a provider, so it belongs
 * beside the catalog.
 */
const NON_LATIN_SCRIPT_CODES: ReadonlySet<string> = new Set([
  "zh",
  "yue",
  "ja",
  "ko",
  "ru",
  "uk",
  "bg",
  "sr",
  "mk",
  "el",
  "he",
  "yi",
  "ar",
  "fa",
  "ur",
  "ug",
  "hi",
  "mr",
  "ne",
  "ks",
  "bn",
  "pa",
  "gu",
  "ta",
  "te",
  "ml",
  "si",
  "km",
  "lo",
  "my",
  "th",
  "ka",
  "am",
  "ti",
  "dv",
  "iu",
]);

/**
 * Whether a translation into `langCode` should carry a romanized companion.
 *
 * False for `auto` and for every code outside the catalog, so a caller never
 * has to check the input first.
 */
export function needsRomanization(langCode: string): boolean {
  return NON_LATIN_SCRIPT_CODES.has(langCode);
}

const FLAG_OVERRIDES: Record<string, string> = {
  auto: "🌐",
  eo: "🌍",
  la: "🏛️",
  cy: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  gd: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

export function getLanguageFlag(code: string): string {
  if (FLAG_OVERRIDES[code]) return FLAG_OVERRIDES[code];
  const country = LANG_TO_COUNTRY[code];
  return country ? flagEmoji(country) : "🏳️";
}

function flagEmoji(country: string): string {
  return String.fromCodePoint(
    ...Array.from(country).map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 0x41),
  );
}
