/**
 * Resolving a language *name* a provider reported back to a canonical code.
 *
 * Whisper-family providers (Groq, and OpenRouter proxying the same model)
 * answer a transcription with the language spelled out in English — "French",
 * "Yoruba", "Cantonese" — where every other provider answers with a code. Our
 * own vocabulary is the opposite: canonical codes everywhere, names only for
 * display. So a detected name has to be folded back into a code before it
 * reaches anything that compares languages, or it silently reads as a language
 * we do not have.
 *
 * The index is derived from {@link ALL_LANGUAGES} rather than hand-listed, so it
 * covers the whole catalog and cannot fall behind it. {@link
 * PROVIDER_DETECTION_NAMES} only carries the names where a provider's meaning
 * differs from, or is absent in, our catalog spelling.
 */
import {
  ALL_LANGUAGES,
  LANGUAGE_CODE_SET,
  type LanguageCode,
} from "./languages";

/**
 * Fold a name to a comparison key: case, diacritics and punctuation carry no
 * meaning for matching, and providers are inconsistent about all three
 * ("Raeto-Romance" vs our "Raeto Romance", "Uighur" vs our "Uyghur").
 */
const key = (raw: string): string =>
  raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

/**
 * Every spelling of one display name worth indexing.
 *
 * A parenthetical qualifies rather than renames — "Chinese (Simplified)" is
 * still Chinese — and a slash offers alternatives rather than a compound, so
 * "Panjabi / Punjabi" has to answer to both halves. Providers send both.
 */
const nameKeys = (name: string): string[] => {
  const base = name.split("(")[0] ?? "";
  return [base, ...base.split("/")].map(key).filter((k) => k.length > 0);
};

/**
 * Names whose meaning here is decided by the provider, not by our catalog.
 *
 * Most entries are a provider label for a language our catalog spells
 * differently ("Khmer" for our "Cambodian"). `norwegian` is the one that is
 * not a spelling difference: our catalog has a generic `no` ("Norwegian") and
 * a concrete `nb` ("Norwegian Bokmål"), but Whisper's only Norwegian token
 * *is* Bokmål — it is also what we send for `nb`, via the `nb -> no` alias in
 * languageCapabilities. So a detected "Norwegian" is Bokmål, and resolving it
 * through the catalog instead would label every Norwegian dictation `no`.
 */
const PROVIDER_DETECTION_NAMES: Readonly<Record<string, LanguageCode>> = {
  norwegian: "nb",
  mandarin: "zh",
  cantonese: "yue",
  "cantonese chinese": "yue",
  "chinese cantonese": "yue",
  flemish: "nl",
  castilian: "es",
  khmer: "km",
  lao: "lo",
  somali: "so",
  sotho: "st",
  kinyarwanda: "rw",
  fulah: "ff",
  fula: "ff",
  "western frisian": "fy",
  kalaallisut: "kl",
  dhivehi: "dv",
  maldivian: "dv",
  limburgish: "li",
  uighur: "ug",
  pushto: "ps",
  odia: "or",
  myanmar: "my",
  "haitian creole": "ht",
  valencian: "ca",
};

/**
 * Narrows a catalog entry's code to the canonical union.
 *
 * `ALL_LANGUAGES` is derived from `LANGUAGE_CODES`, so this cannot fail for data
 * that came from the catalog. It is checked rather than cast because this
 * module's whole job is to be the one place a language string becomes a code
 * the rest of the app trusts — a code that is not in the catalog has to stop
 * here, not reach storage.
 */
const canonical = (code: string): LanguageCode => {
  if (!LANGUAGE_CODE_SET.has(code)) {
    throw new Error(`Language code "${code}" is not in the catalog`);
  }
  return code as LanguageCode;
};

/** Names that resolve to more than one code, so the data has to stay honest. */
const CATALOG_NAME_COLLISIONS: ReadonlyMap<string, readonly string[]> = (() => {
  const owners = new Map<string, Set<string>>();
  for (const { code, englishName, nativeName } of ALL_LANGUAGES) {
    for (const k of [
      ...nameKeys(englishName),
      ...nameKeys(nativeName),
      key(code),
    ]) {
      const seen = owners.get(k) ?? new Set<string>();
      seen.add(code);
      owners.set(k, seen);
    }
  }
  const collisions = new Map<string, readonly string[]>();
  for (const [k, codes] of owners) {
    if (codes.size > 1) collisions.set(k, [...codes]);
  }
  return collisions;
})();

const CATALOG_NAME_INDEX: ReadonlyMap<string, LanguageCode> = (() => {
  const index = new Map<string, LanguageCode>();
  for (const { code, englishName, nativeName } of ALL_LANGUAGES) {
    for (const k of [
      ...nameKeys(englishName),
      ...nameKeys(nativeName),
      key(code),
    ]) {
      // First writer wins, but a contested name is recorded above and asserted
      // empty by test, so this cannot quietly shadow a code in shipped data.
      if (!index.has(k) && !CATALOG_NAME_COLLISIONS.has(k)) {
        index.set(k, canonical(code));
      }
    }
  }
  return index;
})();

/** Values a provider uses to mean "I could not tell", never a language. */
const UNRESOLVED_NAMES: ReadonlySet<string> = new Set([
  "und",
  "undetermined",
  "unknown",
  "unidentified",
  "auto",
]);

/**
 * Every way one reported value could be keyed, most specific first.
 *
 * The full string leads, so a name that genuinely carries a qualifier is not
 * silently reduced to something broader; the base and slash-separated forms
 * follow so that a value we generated ourselves ("Chinese (Simplified)") reads
 * back the same as the bare word a provider sends ("Chinese"). Indexing and
 * lookup share this, so the two can never drift apart.
 */
const lookupKeys = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const keys: string[] = [];
  for (const k of [key(trimmed), ...nameKeys(trimmed)]) {
    if (k.length > 0 && !keys.includes(k)) keys.push(k);
  }
  return keys;
};

/**
 * Fold a language a provider reported into a canonical code.
 *
 * Accepts what providers actually send, in any of the three shapes they use:
 * a code ("fr"), a regional tag ("fr-FR"), or a name ("French", "Yoruba").
 * Returns undefined when the value names something outside the catalog or
 * means "unresolved" — callers must treat that as unknown rather than
 * defaulting it, which is what keeps a mislabel from reaching storage or the
 * UI.
 */
export function canonicalLanguageFromName(
  reported: string | undefined | null,
): LanguageCode | undefined {
  if (!reported) return undefined;

  // A code, possibly regional: "fr", "fr-FR", "fr_FR", "zh-Hans".
  const base = reported.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (LANGUAGE_CODE_SET.has(base)) return base as LanguageCode;

  for (const k of lookupKeys(reported)) {
    if (UNRESOLVED_NAMES.has(k)) return undefined;
    // Provider semantics win over our catalog's own spelling of the same words.
    const provider = PROVIDER_DETECTION_NAMES[k];
    if (provider) return provider;
    const catalog = CATALOG_NAME_INDEX.get(k);
    if (catalog) return catalog;
  }
  return undefined;
}

/** Contested catalog names, exported so the data can be asserted unambiguous. */
export const catalogNameCollisions = (): Record<string, readonly string[]> =>
  Object.fromEntries(CATALOG_NAME_COLLISIONS);
