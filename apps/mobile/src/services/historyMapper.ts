import { FALLBACK_ORIGIN, isHistoryOrigin } from "@ekwe/shared";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";

import type { HistoryRow } from "@/services/db";
import type { EntryType, HistoryEntry } from "@/store";

/**
 * Structural shape of a `history` row as it arrives from Postgres. Declared
 * here rather than imported so the mapper can be shared without depending on
 * the sync service's internals.
 */
export interface HistoryCloudRow {
  id: string;
  user_id: string;
  created_at: string;
  capture_id: string | null;
  origin: string | null;
  input: string | null;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  transliteration_text: string | null;
  duration: number | null;
  source_app: string | null;
  voice_id: string | null;
  stt_provider: string | null;
  mt_provider: string | null;
  type: string | null;
}

/**
 * A row's `origin` column is trustworthy when it holds a known value. Anything
 * else is filed under the fallback — which for every row that could still be
 * reached is Echo, since the column was introduced as `NOT NULL DEFAULT
 * 'echo'` and pre-existing rows were backfilled with exactly that.
 */
function resolveOriginField(origin: string | null): HistoryOrigin {
  if (isHistoryOrigin(origin)) return origin;
  return FALLBACK_ORIGIN;
}

function resolveInputField(
  input: string | null,
  origin: HistoryOrigin,
  duration: number,
): HistoryInput {
  if (input === "text" || input === "audio") return input;
  // Text captures have no recording behind them, so a zero duration on a
  // Speech Studio row means the user typed rather than dictated.
  if (origin === "speech-studio" && duration <= 0) return "text";
  return "audio";
}

function normalizeSourceApp(
  sourceApp: string | null | undefined,
): string | null {
  const trimmed = sourceApp?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEntryType(type: string | null | undefined): EntryType {
  return type === "translation" ? "translation" : "transcription";
}

export function historyRowToEntry(row: HistoryRow): HistoryEntry {
  const duration = row.duration ?? 0;
  const sourceApp = normalizeSourceApp(row.sourceApp);
  const origin = resolveOriginField(row.origin);
  return {
    id: row.id,
    captureId: row.captureId ?? null,
    origin,
    input: resolveInputField(row.input, origin, duration),
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    transcript: row.transcript,
    translation: row.translationText ?? null,
    transliteration: row.transliterationText ?? null,
    duration,
    sourceApp,
    voiceId: row.voiceId ?? null,
    sttProvider: row.sttProvider ?? "",
    mtProvider: row.mtProvider ?? null,
    timestamp: new Date(row.createdAt).getTime(),
    type: normalizeEntryType(row.entryType),
  };
}

export function cloudRowToEntry(row: HistoryCloudRow): HistoryEntry {
  const duration = row.duration ?? 0;
  const sourceApp = normalizeSourceApp(row.source_app);
  const origin = resolveOriginField(row.origin);
  return {
    id: row.id,
    captureId: row.capture_id ?? null,
    origin,
    input: resolveInputField(row.input, origin, duration),
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    transcript: row.transcript,
    translation: row.translation_text ?? null,
    transliteration: row.transliteration_text ?? null,
    duration,
    sourceApp,
    voiceId: row.voice_id ?? null,
    sttProvider: row.stt_provider ?? "",
    mtProvider: row.mt_provider ?? null,
    timestamp: new Date(row.created_at).getTime(),
    type: normalizeEntryType(row.type),
  };
}

/**
 * Fill in an entry written before the capture-id era, so an Undo restores a
 * complete row rather than one missing half its fields.
 */
export function legacyEntryDefaults(
  entry: Partial<HistoryEntry> & Pick<HistoryEntry, "id">,
): HistoryEntry {
  const sourceApp = normalizeSourceApp(entry.sourceApp);
  const duration = entry.duration ?? 0;
  const origin =
    entry.origin && isHistoryOrigin(entry.origin)
      ? entry.origin
      : FALLBACK_ORIGIN;
  return {
    id: entry.id,
    captureId: entry.captureId ?? null,
    origin,
    input:
      entry.input === "text" || entry.input === "audio"
        ? entry.input
        : resolveInputField(null, origin, duration),
    sourceLang: entry.sourceLang ?? "en",
    targetLang: entry.targetLang ?? "en",
    transcript: entry.transcript ?? "",
    translation: entry.translation ?? null,
    transliteration: entry.transliteration ?? null,
    duration,
    sourceApp,
    voiceId: entry.voiceId ?? null,
    sttProvider: entry.sttProvider ?? "",
    mtProvider: entry.mtProvider ?? null,
    timestamp: entry.timestamp ?? 0,
    type: normalizeEntryType(entry.type),
  };
}
