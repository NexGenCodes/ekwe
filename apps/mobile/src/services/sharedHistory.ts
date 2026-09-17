import type { EntryType } from "@/store";

import type { SharedHistoryRecord } from "@ekwe/shared";

/**
 * Pure mapping/decision logic for the native iOS share-extension bridge.
 *
 * The extension (targets/share/EchoHistoryStore.swift) has no JS runtime, so
 * it writes completed work as JSON records into the shared App Group
 * container. The app drains that file and imports each record into history.
 * This module owns the record → entry mapping so the riskiest decision — is a
 * record a transcription or a translation? — is unit-testable in isolation.
 */

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

/**
 * A record counts as a translation only when it carries a non-empty
 * translation that actually differs from the transcript. An identical
 * (or blank) translation means the user closed after transcribing but
 * before translating — keep it as a transcription entry.
 */
export function hasSharedTranslation(
  record: Pick<SharedHistoryRecord, "translation" | "transcript">,
): boolean {
  return (
    !!record.translation?.trim() &&
    record.translation.trim() !== record.transcript?.trim()
  );
}

/**
 * Maps a shared-extension record to the draft used by HistoryService.
 * Normalises optional fields to the same defaults the in-app flow relies on.
 */
export function mapSharedRecordToEntry(
  record: SharedHistoryRecord,
): SharedHistoryEntryDraft {
  const isTranslation = hasSharedTranslation(record);
  return {
    sourceLang: record.sourceLang,
    targetLang: record.targetLang,
    transcript: record.transcript,
    // A transcription entry must never carry a translation: a record whose
    // translation equals the transcript (or is blank) is classified as a
    // transcription, and storing its redundant translation would make the row
    // look translated.
    translation: isTranslation ? (record.translation ?? null) : null,
    transliteration: isTranslation ? (record.transliteration ?? null) : null,
    duration: record.duration ?? 0,
    sourceApp: record.sourceApp || "ios",
    provider: record.provider || "unknown",
    sessionKey: record.sessionKey,
    type: isTranslation ? "translation" : "transcription",
  };
}
