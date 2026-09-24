import {
  getVoiceById,
  STANDARD_VOICE_ID,
  type Voice,
  type VoiceGender,
} from "@ekwe/shared";

import type { VoiceGenderSetting } from "@/store/settings";

export function voiceIdForGender(_gender: VoiceGenderSetting): string {
  return STANDARD_VOICE_ID;
}

export function resolveVoiceGender(
  voiceGender: VoiceGenderSetting | null | undefined,
): VoiceGender | undefined {
  if (voiceGender === "male" || voiceGender === "female") return voiceGender;
  return undefined;
}

export function resolveActiveVoice(
  voiceId: string | null | undefined,
  voiceGender: VoiceGenderSetting | null | undefined,
  fallback: Voice = getVoiceById(STANDARD_VOICE_ID) as Voice,
): Voice {
  let voice: Voice;
  if (voiceId) {
    const explicit = getVoiceById(voiceId);
    voice = explicit ?? fallback;
  } else if (voiceGender) {
    voice = getVoiceById(voiceIdForGender(voiceGender)) ?? fallback;
  } else {
    voice = fallback;
  }

  const gender = resolveVoiceGender(voiceGender);
  if (voice.id === STANDARD_VOICE_ID && gender) {
    return { ...voice, gender };
  }
  return voice;
}
