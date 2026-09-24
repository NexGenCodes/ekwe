import type { EntryType } from "@/store";

import type { SharedHistoryRecord } from "@ekwe/shared";

export type { SharedHistoryRecord };

export interface SharedHistoryEntryDraft {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
  sessionKey?: string;
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

export function mapSharedRecordToEntry(
  record: SharedHistoryRecord,
): SharedHistoryEntryDraft {
  const isTranslation = hasSharedTranslation(record);
  return {
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    transcript: record.transcript,
    translation: isTranslation ? (record.translation ?? null) : null,
    transliteration: isTranslation ? (record.transliteration ?? null) : null,
    duration: record.duration ?? 0,
    sourceApp: record.sourceApp || "ios",
    provider: record.provider || "unknown",
    sessionKey: record.sessionKey,
    type: isTranslation ? "translation" : "transcription",
  };
}
