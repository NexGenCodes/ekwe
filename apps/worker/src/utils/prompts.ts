import { getLanguageName } from "@ekwe/shared";
import { sanitizeProviderOutput } from "@/core/sanitize";

export const ROMANIZATION_MARKER = "<|ekwe:romanization|>";

export function parseTranslateOutput(
  raw: string,
  transliteration: boolean | undefined,
): { translation: string; transliteration?: string } {
  const trimmed = sanitizeProviderOutput(raw.trim());
  if (!transliteration) return { translation: trimmed };

  const markerIndex = trimmed.lastIndexOf(ROMANIZATION_MARKER);
  if (markerIndex === -1) return { translation: trimmed };

  const translation = trimmed.slice(0, markerIndex).trim();
  const romanized = trimmed
    .slice(markerIndex + ROMANIZATION_MARKER.length)
    .trim();
  if (!translation) return { translation: trimmed };
  if (!romanized) return { translation };

  return { translation, transliteration: romanized };
}

/**
 * Takes canonical codes and resolves them here, so a provider can pin the
 * language it must write without knowing our catalog's spelling of it.
 */
export function buildTranslatePrompt(
  targetLang: string,
  sourceLang?: string,
  transliteration?: boolean,
): string {
  const targetName = getLanguageName(targetLang);
  const sourceName =
    sourceLang && sourceLang !== "auto"
      ? getLanguageName(sourceLang)
      : undefined;

  const outputRule = transliteration
    ? `4. Output the translation first, then — ONLY if the target script differs from the Latin alphabet — a blank line, then exactly the marker ${ROMANIZATION_MARKER}, then the romanized pronunciation guide in Latin letters, then nothing else.
5. The romanized guide must cover the full translation word-for-word and contain only Latin alphabet characters.
6. If the target language uses the Latin alphabet, output ONLY the translation (no marker).`
    : `4. Output ONLY the final translated text and nothing else.`;

  return `You are an expert, highly accurate professional translator.
Your sole task is to translate the user's text${sourceName ? ` from ${sourceName}` : ""} into fluent, natural-sounding ${targetName}.
Rules:
1. Preserve the original tone, context, and formatting exactly.
2. Do not add any explanations, conversational text, notes, or preambles.
3. If the text is already in the target language, return it unchanged.
${outputRule}`;
}
