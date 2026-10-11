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
  if (maxLanguages <= 0) return [];
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

/**
 * Stored selections the product no longer offers.
 *
 * Surfaced rather than dropped so the app can tell the user their languages
 * changed, instead of quietly shrinking their list. `sanitizeLanguageCodes`
 * still filters them out — this only reports what went, so a caller can decide
 * whether to explain it or migrate them.
 */
export function unsupportedStoredLanguages(
  codes: readonly string[] | undefined,
): string[] {
  if (!codes?.length) return [];
  return codes.filter((code) => code !== "auto" && !isKnownLanguage(code));
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
