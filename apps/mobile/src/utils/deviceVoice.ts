import * as Speech from "expo-speech";
import { VoiceQuality, type Voice } from "expo-speech";

import type { TtsVoice } from "@/store/settings";

export type DeviceVoiceGender = "male" | "female";

// Voices don't change during a session, and on iOS the first call can return
// [] until the speech engine initializes, so cache the last known non-empty
// result and reuse the in-flight promise to avoid refetch churn.
let cachedVoices: Voice[] = [];
let voiceLoadPromise: Promise<Voice[]> | null = null;

export function loadDeviceVoices(): Promise<Voice[]> {
  voiceLoadPromise ??= Speech.getAvailableVoicesAsync()
    .then((voices) => {
      if (voices.length > 0) cachedVoices = voices;
      return cachedVoices;
    })
    .catch(() => cachedVoices);
  return voiceLoadPromise;
}

/**
 * Whether a Speech error means the device has no usable voice for the language
 * (as opposed to an interruption/transient failure). When true, the UI should
 * tell the user to install the language's voice in system settings.
 */
export function isMissingVoiceError(errorMessage: string): boolean {
  return /no voice found|voice not found|voice.*not (installed|available|downloaded)|not (found|installed|available|downloaded)|synthesis failed|language not supported|language.*not available/i.test(
    errorMessage,
  );
}

// expo-speech does not surface a voice gender on either platform, so gender is
// inferred from the voice identifier/name. Android engines tag genders in the
// identifier (`#female_1`, `-male-`, names like "English (US) Male 2"); iOS
// exposes no token at all, so a curated list of known AVSpeechSynthesisVoice
// names is used as the fallback. Voices that cannot be classified are left to
// the system default, so Listen always still works.

const FEMALE_NAMES = new Set([
  "alice",
  "allison",
  "alva",
  "amelie",
  "angelica",
  "anna",
  "ava",
  "carmit",
  "claire",
  "damayanti",
  "ellen",
  "federica",
  "fiona",
  "ida",
  "ioana",
  "joana",
  "joelle",
  "kanya",
  "karen",
  "kyoko",
  "laura",
  "lekha",
  "luciana",
  "marie",
  "mariska",
  "martha",
  "meijia",
  "melina",
  "milena",
  "moira",
  "monica",
  "nora",
  "paulina",
  "petra",
  "samantha",
  "satu",
  "serena",
  "sinji",
  "susan",
  "tessa",
  "tingting",
  "victoria",
  "yelda",
  "yuna",
  "zosia",
  "zuzana",
]);

const MALE_NAMES = new Set([
  "aaron",
  "alex",
  "arthur",
  "carlos",
  "daniel",
  "diego",
  "eddy",
  "enrique",
  "felipe",
  "francisco",
  "fred",
  "gordon",
  "hattori",
  "jorge",
  "juan",
  "li-mu",
  "luca",
  "maged",
  "markus",
  "mateo",
  "nathan",
  "nikos",
  "oliver",
  "otoya",
  "paulo",
  "radu",
  "ricardo",
  "rishi",
  "rodrigo",
  "thomas",
  "tom",
  "xander",
  "yuri",
]);

function firstToken(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\u00e0-\u017f\s-]/g, "")
    .split(/[\s-]+/)
    .find((token) => token.length > 0) ?? "";
}

/**
 * Infers a voice's gender from its identifier and name. Returns `null` when the
 * gender cannot be determined, in which case the caller should fall back to the
 * platform default voice.
 */
export function inferVoiceGender(voice: {
  identifier: string;
  name: string;
}): DeviceVoiceGender | null {
  const haystack = `${voice.identifier} ${voice.name}`.toLowerCase();

  // Token-based detection covers Android engines ("#male_2", "-female-",
  // "English (US) Male 2"). "female" must be checked before "male" because it
  // contains "male" as a substring.
  if (haystack.includes("female")) return "female";
  if (haystack.includes("male")) return "male";

  const name = firstToken(voice.name);
  if (FEMALE_NAMES.has(name)) return "female";
  if (MALE_NAMES.has(name)) return "male";

  return null;
}

/**
 * Picks the best available device voice for the requested language and gender.
 * Hard-mismatched genders are excluded; unclassified voices remain eligible as
 * a safe default. Returns `undefined` when no usable voice exists, so the caller
 * can fall back to the platform default voice.
 */
export function pickDeviceVoice(
  voices: Voice[],
  lang: string,
  gender: TtsVoice,
): Voice | undefined {
  // "default" means the user hasn't chosen a gender — let the platform pick.
  if (gender === "default") return undefined;

  const langCode = lang.split("-")[0].toLowerCase();
  const candidates = voices.filter((voice) =>
    voice.language?.toLowerCase().startsWith(langCode),
  );
  if (candidates.length === 0) return undefined;

  let best: Voice | undefined;
  let bestScore = -1;

  for (const voice of candidates) {
    const inferred = inferVoiceGender(voice);
    if (inferred !== null && inferred !== gender) continue;

    let score = inferred === gender ? 4 : 1;
    if (voice.quality === VoiceQuality.Enhanced) score += 2;
    if (voice.language.toLowerCase() === lang.toLowerCase()) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }

  return best;
}