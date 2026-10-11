export type VoiceGender = "male" | "female";
export type VoiceTier = "free" | "pro";

/**
 * A product voice slot. A slot is an *entitlement label*, not a voice: it
 * selects which provider pipeline a request is allowed to draw from. The
 * actual voice is resolved per (slot, gender, language) by the worker.
 */
export interface VoiceSlot {
  readonly id: string;
  readonly name: string;
  /**
   * The descriptor alone, with the tier prefix dropped.
   *
   * `name` is the picker label and carries the tier ("Studio · Clear"), which
   * is what the industry does for a voice-quality tier. Provenance lines need
   * only the descriptor, because the surface already names itself there — with
   * both, a Studio row read "Studio · Studio · Clear".
   */
  readonly shortName: string;
  readonly tier: VoiceTier;
  readonly tagline: string;
}

/** The audition line used to sample a voice's timbre. */
export const VOICE_PREVIEW_TEXT = "Hi, this is how I sound.";

/**
 * Bump to invalidate every memoized voice preview on clients.
 *
 * A slot resolves to a provider voice per (gender, language, tier) and can
 * fail over at runtime, so a cached preview can drift from what a slot now
 * produces. Bumping this retires the old files on next launch.
 */
export const VOICE_PREVIEW_VERSION = 3;

export const STANDARD_VOICE_ID = "standard";
export const STUDIO_VOICE_ID = "studio";
export const STUDIO_WARM_VOICE_ID = "studio-2";

export const VOICE_SLOTS = [
  {
    id: STANDARD_VOICE_ID,
    name: "Standard",
    shortName: "Standard",
    tier: "free",
    tagline: "Clear, natural everyday voice",
  },
  {
    id: STUDIO_VOICE_ID,
    name: "Studio · Clear",
    shortName: "Clear",
    tier: "pro",
    tagline: "Measured, confident, easy to listen to",
  },
  {
    id: STUDIO_WARM_VOICE_ID,
    name: "Studio · Warm",
    shortName: "Warm",
    tier: "pro",
    tagline: "Softer and friendlier, for personal notes",
  },
] as const satisfies readonly VoiceSlot[];

export const VOICE_SLOT_IDS = VOICE_SLOTS.map((slot) => slot.id) as [
  string,
  ...string[],
];

const SLOT_BY_ID = new Map<string, VoiceSlot>(
  VOICE_SLOTS.map((slot) => [slot.id, slot]),
);

export function getVoiceSlot(
  id: string | null | undefined,
): VoiceSlot | undefined {
  if (!id) return undefined;
  return SLOT_BY_ID.get(id);
}

export function getStandardSlot(): VoiceSlot {
  return SLOT_BY_ID.get(STANDARD_VOICE_ID) as VoiceSlot;
}
