import { getTtsProviderNames, ttsProviderSupports } from "../core/config";
import { withCache } from "../core/cache";

/**
 * Curated voice lists per provider per gender. Must match VOICE_LISTS in tts.ts.
 */
const VOICE_LISTS: Record<
  string,
  { male: readonly string[]; female: readonly string[] }
> = {
  gemini: {
    male: ["Puck", "Charon", "Fenrir"],
    female: ["Zephyr", "Kore", "Leda"],
  },
  aura2: {
    male: ["orion", "apollo", "zeus"],
    female: ["helena", "luna", "asteria"],
  },
  aura1: {
    male: ["orion", "orpheus", "angus"],
    female: ["athena", "luna", "asteria"],
  },
  melotts: {
    male: [""],
    female: [""],
  },
};

export interface VoiceEntry {
  provider: string;
  gender: "male" | "female";
  voices: readonly string[];
  languages: readonly string[];
}

/**
 * GET /voices — returns the available TTS voices across all providers.
 * Supports optional `lang` query param to filter by language support.
 * Auth: none (public metadata endpoint).
 */
export async function handleVoices(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(request, ctx, () => {
    const url = new URL(request.url);
    const langFilter = url.searchParams.get("lang") || undefined;

    const providers = getTtsProviderNames();
    const voices: VoiceEntry[] = [];

    for (const provider of providers) {
      const list = VOICE_LISTS[provider];
      if (!list) continue;

      // If lang filter requested, skip providers that don't support it
      if (langFilter && !ttsProviderSupports(provider, langFilter)) continue;

      // Get supported languages for this provider (approximate from config)
      const languages = provider === "aura2"
        ? (["en", "es"] as const)
        : provider === "melotts"
          ? (["en", "es", "fr", "de", "hi", "pt", "zh", "ja", "ko"] as const)
          : (["en", "es", "fr", "de", "hi", "pt", "zh", "ja", "ko", "ar", "it", "nl", "pl", "ru", "th", "vi", "id", "tr"] as const);

      for (const gender of ["male", "female"] as const) {
        const voiceNames = list[gender];
        // Skip empty arrays (melotts has no voice selection)
        const filtered = voiceNames.filter((v) => v.length > 0);
        if (filtered.length === 0) continue;

        voices.push({
          provider,
          gender,
          voices: filtered,
          languages,
        });
      }
    }

    return Response.json({ voices }, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }, 3600);
}