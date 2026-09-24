export type VoiceGender = "male" | "female";
export type VoiceTier = "free" | "pro";
export type VoiceOrigin = "standard" | "builtin" | "clone";

export interface Voice {
  id: string;
  name: string;
  gender: VoiceGender;
  tier: VoiceTier;
  origin: VoiceOrigin;

  tagline: string;
}

export const STANDARD_VOICE_ID = "standard";

export const VOICE_PREVIEW_TEXT = "Hi, this is how I sound.";

export const VOICES: Voice[] = [
  {
    id: "standard",
    name: "Standard",
    gender: "female",
    tier: "free",
    origin: "standard",
    tagline: "Basic synthetic voice",
  },
  {
    id: "studio-female-1",
    name: "Studio 1 (Female)",
    gender: "female",
    tier: "pro",
    origin: "builtin",
    tagline: "Warm and expressive studio voice",
  },
  {
    id: "studio-female-2",
    name: "Studio 2 (Female)",
    gender: "female",
    tier: "pro",
    origin: "builtin",
    tagline: "Soft and soothing for longer notes",
  },
  {
    id: "studio-male-1",
    name: "Studio 1 (Male)",
    gender: "male",
    tier: "pro",
    origin: "builtin",
    tagline: "Rich, expressive studio voice",
  },
  {
    id: "studio-male-2",
    name: "Studio 2 (Male)",
    gender: "male",
    tier: "pro",
    origin: "builtin",
    tagline: "Deep and clear, confident tone",
  },
] as const;

export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];

export function getVoicesByGender(gender: VoiceGender): Voice[] {
  return VOICES.filter(
    (v) => v.gender === gender || v.id === STANDARD_VOICE_ID,
  );
}

export function getVoiceById(id: string): Voice | undefined {
  return VOICES.find((v) => v.id === id);
}
