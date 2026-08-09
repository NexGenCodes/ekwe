import { LANGUAGES } from "@/constants/languages";

export const DEFAULT_LANGUAGES: string[] = LANGUAGES.filter(
  (l) => l.defaultSelected,
).map((l) => l.code);

export function getDefaultSourceLang(autoDetectAllowed: boolean): string {
  return autoDetectAllowed ? "auto" : "en";
}

/**
 * Resolves the effective source language from a transcript/translation result.
 *
 * A provider-reported language is only a *genuine detection* when it differs
 * from the language the user asked for (or the user asked for auto-detect).
 * When the provider merely echoes the requested language back, nothing was
 * detected — the user's selection is the source. Returns `null` when auto was
 * requested but nothing was detected (unknown).
 */
export function resolveDetectedLanguage(
  detectedLang: string | undefined | null,
  sourceLang: string,
  fallback: string = "en",
): string | null {
  const reported = detectedLang && detectedLang !== "auto" && detectedLang !== "und"
    ? detectedLang
    : null;

  // Auto-detect request: the provider's report is the answer.
  if (sourceLang === "auto") return reported;

  // Explicit source: only accept a DIFFERENT language as a detection signal.
  if (reported && reported !== sourceLang) return reported;

  // No detection — the user's chosen source (or fallback) wins.
  if (sourceLang && sourceLang !== "auto") return sourceLang;
  return fallback;
}

/**
 * True only when the provider genuinely detected a language that the user did
 * not just echo back (i.e. auto-detect was requested, or the reported language
 * contradicts the user's selection). Drives "Detected ·" vs "Source ·" labels.
 */
export function isGenuineLanguageDetection(
  detectedLang: string | undefined | null,
  requestedLang: string,
): boolean {
  if (!detectedLang || detectedLang === "auto" || detectedLang === "und")
    return false;
  if (requestedLang === "auto") return true;
  return detectedLang !== requestedLang;
}
