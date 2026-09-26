import {
  getStandardSlot,
  getVoiceSlot,
  type VoiceGender,
  type VoiceSlot,
} from "@ekwe/shared";

import type { VoiceGenderSetting } from "@/store/settings";

/**
 * A slot paired with the gender to render it in. The two are independent: a
 * slot says which pipeline is allowed, the gender says which voice is picked
 * out of it. Keeping them in one object stops the picker from ever previewing
 * a voice that disagrees with the tab it was tapped under.
 */
export interface VoiceSelection {
  slot: VoiceSlot;
  gender: VoiceGender;
}

/** `"default"` means the user has not chosen, so fall back to Standard/female. */
export function resolveVoiceGender(
  voiceGender: VoiceGenderSetting | null | undefined,
): VoiceGender {
  return voiceGender === "male" ? "male" : "female";
}

/**
 * Resolves the active selection from persisted settings. An unknown or missing
 * slot id degrades to Standard rather than failing, so a stale value can never
 * leave the user without a voice.
 */
export function resolveVoiceSelection(
  voiceId: string | null | undefined,
  voiceGender: VoiceGenderSetting | null | undefined,
): VoiceSelection {
  return {
    slot: getVoiceSlot(voiceId) ?? getStandardSlot(),
    gender: resolveVoiceGender(voiceGender),
  };
}
