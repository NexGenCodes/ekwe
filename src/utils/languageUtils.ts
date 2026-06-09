export function getDefaultSourceLang(): string {
  return "auto";
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
