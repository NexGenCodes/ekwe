import { LANGUAGES } from "@/constants/languages";

export const DEFAULT_LANGUAGES: string[] = LANGUAGES.filter(
  (l) => l.defaultSelected,
).map((l) => l.code);

export function getDefaultSourceLang(autoDetectAllowed: boolean): string {
  return autoDetectAllowed ? "auto" : "en";
}

export function resolveDetectedLanguage(
  detectedLang: string | undefined | null,
  sourceLang: string,
  fallback: string = "en",
): string {
  if (detectedLang && detectedLang !== "auto" && detectedLang !== "und")
    return detectedLang;
  if (sourceLang !== "auto") return sourceLang;
  return fallback;
}
