import { FALLBACK_ORIGIN, isHistoryOrigin } from "@ekwe/shared";
import type {
  HistoryInput,
  HistoryOrigin,
  SharedHistoryRecord,
} from "@ekwe/shared";

import type { EntryType } from "@/store";

export type { SharedHistoryRecord };

export interface SharedHistoryEntryDraft {
  captureId: string;
  origin: HistoryOrigin;
  input: HistoryInput;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string | null;
  voiceId: string | null;
  sttProvider: string;
  mtProvider: string | null;
  type: EntryType;
}

export function hasSharedTranslation(
  record: Pick<SharedHistoryRecord, "translation" | "transcript">,
): boolean {
  return (
    !!record.translation?.trim() &&
    record.translation.trim() !== record.transcript?.trim()
  );
}

/**
 * Map a record written by the iOS share extension into a history write.
 *
 * The extension runs the full pipeline natively, so every record it produces is
 * an `echo` capture. `sessionKey` is the extension's own in-file dedup key and
 * is a stable identifier for the capture, which is exactly what the history
 * layer now needs — so it is promoted to `captureId` rather than discarded as
 * it used to be.
 */
export function mapSharedRecordToEntry(
  record: SharedHistoryRecord,
): SharedHistoryEntryDraft {
  const isTranslation = hasSharedTranslation(record);
  return {
    captureId: record.sessionKey,
    origin: isHistoryOrigin(record.origin) ? record.origin : FALLBACK_ORIGIN,
    input: record.input === "text" ? "text" : "audio",
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    transcript: record.transcript,
    translation: isTranslation ? (record.translation ?? null) : null,
    transliteration: isTranslation ? (record.transliteration ?? null) : null,
    duration: record.duration ?? 0,
    sourceApp: record.sourceApp?.trim() ? record.sourceApp : null,
    voiceId: record.voiceId?.trim() ? record.voiceId : null,
    sttProvider: record.provider || "unknown",
    mtProvider: record.mtProvider?.trim() ? record.mtProvider : null,
    type: isTranslation ? "translation" : "transcription",
  };
}
