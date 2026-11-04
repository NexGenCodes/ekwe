import { observable, computed } from "@legendapp/state";
import type { HistoryInput, HistoryOrigin } from "@ekwe/shared";

/**
 * Retained as a stored column for backwards compatibility with older clients.
 * It is no longer a user-facing concept: one row exists per capture, so whether
 * an entry carries a translation is derivable from `translation` being set.
 */
export type EntryType = "transcription" | "translation";

/**
 * One row per capture. Audio is never stored — see `@ekwe/shared/origins` —
 * so an entry is entirely text plus the metadata describing where it came from.
 */
export interface HistoryEntry {
  id: string;
  /**
   * Stable identifier for the capture session. Reused when a later step of the
   * same capture (typically translation) updates this row in place.
   */
  captureId: string | null;
  /** Which surface captured it. */
  origin: HistoryOrigin;
  /** What that surface consumed. */
  input: HistoryInput;
  /** Always a resolved language code; never "auto". */
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration?: string | null;
  timestamp: number;
  /** Seconds of *source* audio. 0 when the capture had no audio. */
  duration: number;
  /** The external app the audio came from. Null for in-app captures. */
  sourceApp: string | null;
  /** Voice slot used to render speech, for Studio entries. */
  voiceId: string | null;
  /** Which speech-to-text provider heard it. */
  sttProvider: string;
  /** Which MT provider translated it. Null until translated. */
  mtProvider: string | null;
  type?: EntryType;
}

export const history$ = observable<Record<string, HistoryEntry>>({});

export const sortedHistory$ = computed(() => {
  const all = history$.get();
  if (!all) return [];
  return Object.values(all)
    .filter((entry): entry is HistoryEntry => Boolean(entry))
    .sort((a, b) => b.timestamp - a.timestamp);
});
