import { PLAN_LIMITS } from "@/constants/billing";
import { LANGUAGES, isKnownLanguage } from "@/constants/languages";
import { auth$ } from "@/store";

export const DEFAULT_LANGUAGES: string[] = LANGUAGES.filter(
  (l) => l.defaultSelected,
).map((l) => l.code);

export function sanitizeLanguageCodes(
  codes: readonly string[],
  maxLanguages: number,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    if (code === "auto" || seen.has(code) || !isKnownLanguage(code)) continue;
    seen.add(code);
    result.push(code);
    if (result.length >= maxLanguages) break;
  }
  return result;
}

export function getDefaultSourceLang(autoDetectAllowed: boolean): string {
  return autoDetectAllowed ? "auto" : "en";
}

export function isAutoDetectPermitted(): boolean {
  return PLAN_LIMITS[auth$.isPro.peek() ? "pro" : "free"].autoDetectAllowed;
}

export function resolveDetectedLanguage(
  detectedLang: string | undefined | null,
  sourceLang: string,
  fallback: string = "en",
): string | null {
  const reported =
    detectedLang && detectedLang !== "auto" && detectedLang !== "und"
      ? detectedLang
      : null;

  if (sourceLang === "auto") return reported ?? fallback;

  if (reported && reported !== sourceLang) return reported;

  if (sourceLang && sourceLang !== "auto") return sourceLang;
  return fallback;
}

export function isGenuineLanguageDetection(
  detectedLang: string | undefined | null,
  requestedLang: string,
): boolean {
  if (!detectedLang || detectedLang === "auto" || detectedLang === "und")
    return false;
  if (requestedLang === "auto") return true;
  return detectedLang !== requestedLang;
}
