import {
  FALLBACK_ORIGIN,
  ORIGIN_META,
  getVoiceSlot,
  isHistoryOrigin,
} from "@ekwe/shared";
import type { HistoryOrigin } from "@ekwe/shared";

import { getLanguageName } from "@/constants/languages";
import { formatSourceApp } from "@/utils/formatSource";
import type { HistoryEntry } from "@/store";

/**
 * The origin an entry should be filed under.
 *
 * Anything unrecognised is filed under the fallback. There is no `source_app`
 * derivation left: the column is `NOT NULL DEFAULT 'echo'`, so a stored row
 * can never arrive without a value that is already valid, and the old map was
 * unreachable for every row it looked like it was serving.
 */
export function resolveOrigin(entry: HistoryEntry): HistoryOrigin {
  if (isHistoryOrigin(entry.origin)) return entry.origin;
  return FALLBACK_ORIGIN;
}

export function originLabel(origin: HistoryOrigin): string {
  return ORIGIN_META[origin].label;
}

/**
 * A translation only counts when it says something the transcript does not. A
 * provider that echoes the source back would otherwise make an untranslated
 * capture look translated in the meta line, the icon tint, and the detail
 * sheet's second block.
 */
function hasDistinctTranslation(entry: HistoryEntry): boolean {
  const translation = entry.translation?.trim();
  if (!translation) return false;
  return translation !== entry.transcript?.trim();
}

/**
 * `source_app` values that were placeholders rather than real app names.
 * Echo is the only surface that ever wrote a genuine package name, so anything
 * in this set means "we don't actually know" and should not be shown as one.
 */
const PLACEHOLDER_SOURCE_APPS = new Set([
  "ios",
  "unknown",
  "unknown app",
  "none",
  "audio",
  "ekwe",
  "ekwe-home",
  "shared",
  "shared-text",
]);

function appNameOrNull(sourceApp: string | null): string | null {
  if (!sourceApp) return null;
  if (PLACEHOLDER_SOURCE_APPS.has(sourceApp.trim().toLowerCase())) return null;
  return formatSourceApp(sourceApp);
}

/**
 * How an entry describes its provenance, for the row's meta line.
 *
 * Echo and Orb name the app the audio came from, because that is the useful
 * fact. Speech Studio captures happened inside Ekwe, so there is no app to name
 * and the voice that rendered them stands in — by its descriptor alone, since
 * the surface has already named itself.
 */
export function originProvenanceLabel(entry: HistoryEntry): string {
  const origin = resolveOrigin(entry);

  if (origin === "speech-studio") {
    const slot = getVoiceSlot(entry.voiceId);
    return slot
      ? `${ORIGIN_META[origin].label} · ${slot.shortName}`
      : ORIGIN_META[origin].label;
  }

  const app = appNameOrNull(entry.sourceApp);
  return app
    ? `${ORIGIN_META[origin].label} · ${app}`
    : ORIGIN_META[origin].label;
}

/** `ES → FR` for a translated capture, `ES` for one that was never translated. */
export function entryLanguageLabel(entry: HistoryEntry): string {
  const source = (entry.sourceLang || "en").toUpperCase();
  if (!hasDistinctTranslation(entry)) return source;
  const target = (entry.targetLang || "").toUpperCase();
  return target ? `${source} → ${target}` : source;
}

export function formatEntryDuration(seconds: number): string | null {
  if (!seconds) return null;
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Spoken for screen readers, where the segmented meta line would be noise. */
export function entryAccessibilityLabel(entry: HistoryEntry): string {
  const origin = resolveOrigin(entry);
  const app = appNameOrNull(entry.sourceApp);
  const who = app
    ? `${ORIGIN_META[origin].label}, from ${app}`
    : ORIGIN_META[origin].label;
  const sourceName = getLanguageName(entry.sourceLang || "en");
  const targetName = entry.targetLang
    ? getLanguageName(entry.targetLang)
    : null;
  const languages =
    hasDistinctTranslation(entry) && targetName
      ? `${sourceName} translated to ${targetName}`
      : sourceName;
  const firstLine = entry.transcript?.split("\n")[0]?.trim() || "Voice note";
  return `${firstLine}. ${who}. ${languages}.`;
}
