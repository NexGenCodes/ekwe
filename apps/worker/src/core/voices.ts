import type { VoiceGender, VoiceSlot } from "@ekwe/shared";
import type { Tier } from "@/core/limits";
import type { SpeechGender } from "@/core/types";
import {
  getProviderModule,
  getProviderNamesFor,
  providerSupportsLanguage,
} from "@/providers";

export interface VoiceCandidate {
  provider: string;
  voice: string;
}

export function pipelineTierForSlot(slot: VoiceSlot | undefined): Tier {
  return slot?.tier === "pro" ? "PREMIUM" : "FREE";
}

/**
 * The budget gate can only *downgrade* the pipeline a slot asked for, never
 * upgrade it. A throttled Pro user asking for Studio still gets audio, served
 * by the free pool, instead of an error.
 */
export function resolveExecutionTier(slotTier: Tier, gateTier: Tier): Tier {
  return slotTier === "FREE" || gateTier === "FREE" ? "FREE" : slotTier;
}

export function resolveProviderVoices(
  provider: string,
  gender: SpeechGender | undefined,
  langCode: string,
): string[] {
  return getProviderModule(provider)?.voices?.(gender, langCode) ?? [];
}

/**
 * A slot references a provider *position*, never a voice name.
 *
 * Deepgram voices are locale-bound — `aura-2-vesta-es` does not exist — so a
 * named voice in this table would break every non-English language. An index
 * stays correct for all supported languages for free, and the providers' own
 * lists stay the single source of truth for which voice that is.
 */
interface VoiceRef {
  readonly provider: string;
  /** 0 = the Clear persona, 1 = the Warm persona, 2+ = generic fallback. */
  readonly at: number;
}

const ref = (provider: string, at = 0): VoiceRef => ({ provider, at });

/**
 * Each provider's gendered list is ordered so that position 0 and position 1
 * are the Clear and Warm personas respectively. Because the index means the
 * same thing everywhere, a failover from one provider to the next stays in
 * character instead of swapping timbre.
 */
const SLOT_POOLS: Readonly<
  Record<string, Record<VoiceGender, readonly VoiceRef[]>>
> = {
  standard: {
    female: [ref("edge"), ref("edge", 1), ref("witai")],
    male: [ref("edge"), ref("edge", 1), ref("witai")],
  },
  studio: {
    female: [
      ref("gemini"),
      ref("deepgram"),
      ref("elevenlabs"),
      ref("edge"),
      ref("witai"),
    ],
    male: [
      ref("gemini"),
      ref("deepgram"),
      ref("elevenlabs"),
      ref("edge"),
      ref("witai"),
    ],
  },
  "studio-2": {
    female: [
      ref("gemini", 1),
      ref("deepgram", 1),
      ref("elevenlabs", 1),
      ref("edge"),
      ref("witai", 1),
    ],
    male: [
      ref("gemini", 1),
      ref("deepgram", 1),
      ref("elevenlabs", 1),
      ref("edge"),
      ref("witai", 1),
    ],
  },
};

const NO_POOL: Record<VoiceGender, readonly VoiceRef[]> = {
  female: [],
  male: [],
};

/**
 * The ordered failover candidates for a slot, gender and language.
 *
 * At most one candidate per provider: the provider's own ranked list supplies
 * within-provider failover, so listing it twice would just burn a slot on a
 * request that has already failed.
 *
 * A position the provider does not have for this language is skipped rather
 * than clamped. French Deepgram publishes one voice per gender, so clamping
 * would silently hand the Warm persona the Clear voice.
 *
 * An unset gender resolves against the female refs, which lines up with every
 * provider's own `default` voice.
 */
export function resolveVoicePool(
  slot: VoiceSlot | undefined,
  gender: SpeechGender | undefined,
  lang: string,
  executionTier: Tier,
): VoiceCandidate[] {
  const pool = (slot ? SLOT_POOLS[slot.id] : undefined) ?? NO_POOL;
  const resolvedGender = gender ?? "female";
  const refs = pool[resolvedGender];

  const allowed = new Set(getProviderNamesFor("tts", executionTier));
  const langCode = lang.split("-")[0].toLowerCase();

  const candidates: VoiceCandidate[] = [];
  const seen = new Set<string>();

  for (const { provider, at } of refs) {
    if (seen.has(provider)) continue;
    if (!allowed.has(provider)) continue;
    if (!providerSupportsLanguage(provider, "tts", lang)) continue;

    const voice = resolveProviderVoices(provider, resolvedGender, langCode)[at];
    if (!voice) continue;

    seen.add(provider);
    candidates.push({ provider, voice });
  }

  return candidates;
}

/** Groups a pool per provider, preserving the pool's preference order. */
export function groupCandidatesByProvider(
  candidates: readonly VoiceCandidate[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { provider, voice } of candidates) {
    const list = grouped.get(provider);
    if (list) list.push(voice);
    else grouped.set(provider, [voice]);
  }
  return grouped;
}
