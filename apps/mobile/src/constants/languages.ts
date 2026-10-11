import { LANGUAGES as BASE_LANGUAGES } from "@ekwe/shared/languages";
import type { Language as BaseLanguage } from "@ekwe/shared/languages";
import {
  LANGUAGE_BY_CODE,
  SUPPORTED_LANGUAGE_CODE_SET,
} from "@ekwe/shared/languages";

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
  return LANGUAGE_BY_CODE.get(code)?.englishName ?? code;
};

/**
 * Whether the product offers this language.
 *
 * Deliberately checks the offered set rather than the catalog. The catalog keeps
 * languages we once supported so a stored selection still resolves to a real
 * name, and reading it here is exactly how an unsupported language would leak
 * back into the picker through `sanitizeLanguageCodes`.
 */
export const isKnownLanguage = (code: string): boolean =>
  SUPPORTED_LANGUAGE_CODE_SET.has(code);

export const getLanguageAbbreviation = (code: string): string => {
  if (code === "auto") return "AUTO";
  const lang = LANGUAGE_BY_CODE.get(code);
  return (lang?.code ?? code)?.toUpperCase() ?? "";
};
