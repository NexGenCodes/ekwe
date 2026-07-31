import { LANGUAGES as BASE_LANGUAGES } from "@shared/languages";
import type { Language as BaseLanguage } from "@shared/languages";

export interface Language extends BaseLanguage {
  groqCode: string;
  defaultSelected: boolean;
  fillerWords: string[];
}

interface LanguageExt {
  groqCode?: string;
  defaultSelected?: boolean;
  fillerWords?: string[];
}

const EXTENSIONS: Record<string, LanguageExt> = {
  en: {
    defaultSelected: true,
    fillerWords: [
      "um",
      "uh",
      "like",
      "you know",
      "so",
      "right",
      "basically",
      "literally",
      "actually",
      "i mean",
    ],
  },
  es: {
    defaultSelected: true,
    fillerWords: [
      "eh",
      "este",
      "bueno",
      "o sea",
      "pues",
      "mira",
      "sabes",
      "tipo",
    ],
  },
  it: {
    defaultSelected: true,
    fillerWords: [
      "allora",
      "cioè",
      "tipo",
      "ecco",
      "boh",
      "mah",
      "quindi",
      "sai",
    ],
  },
  de: {
    defaultSelected: true,
    fillerWords: [
      "ähm",
      "äh",
      "halt",
      "so",
      "irgendwie",
      "eigentlich",
      "quasi",
      "also",
    ],
  },
  zh: {
    defaultSelected: true,
    fillerWords: ["那个", "就是", "然后", "对", "嗯", "这个"],
  },
  nb: { groqCode: "no" },
};

export const LANGUAGES: Language[] = BASE_LANGUAGES.map((l) => ({
  ...l,
  groqCode: EXTENSIONS[l.code]?.groqCode ?? l.code,
  defaultSelected: EXTENSIONS[l.code]?.defaultSelected ?? false,
  fillerWords: EXTENSIONS[l.code]?.fillerWords ?? [],
}));

export const getLanguageName = (code: string): string => {
  if (code === "auto") return "Auto";
  return LANGUAGES.find((l) => l.code === code)?.englishName ?? code;
};

export const getLanguageAbbreviation = (code: string): string => {
  if (code === "auto") return "AUTO";
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) return code.toUpperCase();
  return lang.englishName.substring(0, 3).toUpperCase();
};

export const FLAG_MAP: Record<string, string> = {
  en: "🇬🇧",
  es: "🇪🇸",
  it: "🇮🇹",
  de: "🇩🇪",
  zh: "🇨🇳",
  fr: "🇫🇷",
  pt: "🇵🇹",
  ru: "🇷🇺",
  ja: "🇯🇵",
  ko: "🇰🇷",
  ar: "🇸🇦",
  hi: "🇮🇳",
  nl: "🇳🇱",
  pl: "🇵🇱",
  tr: "🇹🇷",
  sv: "🇸🇪",
  da: "🇩🇰",
  fi: "🇫🇮",
  nb: "🇳🇴",
  cs: "🇨🇿",
  sk: "🇸🇰",
  ro: "🇷🇴",
  hu: "🇭🇺",
  uk: "🇺🇦",
  el: "🇬🇷",
  he: "🇮🇱",
  th: "🇹🇭",
  vi: "🇻🇳",
  id: "🇮🇩",
  ms: "🇲🇾",
  bg: "🇧🇬",
  hr: "🇭🇷",
  sr: "🇷🇸",
  ca: "🇪🇸",
  lt: "🇱🇹",
  lv: "🇱🇻",
  et: "🇪🇪",
  sl: "🇸🇮",
  sq: "🇦🇱",
  mk: "🇲🇰",
  af: "🇿🇦",
  bn: "🇧🇩",
  fa: "🇮🇷",
  ur: "🇵🇰",
  sw: "🇰🇪",
  tl: "🇵🇭",
  ta: "🇮🇳",
  te: "🇮🇳",
  ml: "🇮🇳",
  mr: "🇮🇳",
  gu: "🇮🇳",
  pa: "🇮🇳",
  ne: "🇳🇵",
  si: "🇱🇰",
  km: "🇰🇭",
  lo: "🇱🇦",
  my: "🇲🇲",
  ka: "🇬🇪",
  yo: "🇳🇬",
  ig: "🇳🇬",
  ha: "🇳🇬",
  zu: "🇿🇦",
  so: "🇸🇴",
  am: "🇪🇹",
  az: "🇦🇿",
  uz: "🇺🇿",
  kk: "🇰🇿",
  mn: "🇲🇳",
  hy: "🇦🇲",
  jv: "🇮🇩",
  su: "🇮🇩",
  bs: "🇧🇦",
  is: "🇮🇸",
  ga: "🇮🇪",
  cy: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  gd: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  gl: "🇪🇸",
  eu: "🇪🇸",
  mt: "🇲🇹",
  xh: "🇿🇦",
  sn: "🇿🇼",
  st: "🇱🇸",
  ny: "🇲🇼",
  rw: "🇷🇼",
  mg: "🇲🇬",
  tk: "🇹🇲",
  ky: "🇰🇬",
  tg: "🇹🇯",
  ps: "🇦🇫",
  sd: "🇵🇰",
  mni: "🇮🇳",
  as: "🇮🇳",
  or: "🇮🇳",
};
