import { LANGUAGES as BASE_LANGUAGES } from "@ekwe/shared/languages";
import type { Language as BaseLanguage } from "@ekwe/shared/languages";
import { languageName as sharedLanguageName } from "@ekwe/shared/languages";

export { getLanguageFlag } from "@ekwe/shared/languages";

export interface Language extends BaseLanguage {
  defaultSelected: boolean;
  fillerWords: string[];
}

interface LanguageExt {
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
};

export const LANGUAGES: Language[] = BASE_LANGUAGES.map((l) => ({
  ...l,
  defaultSelected: EXTENSIONS[l.code]?.defaultSelected ?? false,
  fillerWords: EXTENSIONS[l.code]?.fillerWords ?? [],
}));

export const getLanguageName = (code: string): string => {
  if (code === "auto") return "Auto";
  return sharedLanguageName(code);
};

export const getLanguageAbbreviation = (code: string): string => {
  if (code === "auto") return "AUTO";
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) return code.toUpperCase();
  return lang.englishName.substring(0, 3).toUpperCase();
};
