import { observable } from "@legendapp/state";

/**
 * The operation that produced the entry. A user either transcribes (audio →
 * text) or translates (text → text) — never both at once. An entry that was
 * transcribed and later translated keeps type "transcription"; the presence of
 * a distinct translation is a derived "translated" state, not a third type.
 */
export type EntryType = "transcription" | "translation";

export interface HistoryEntry {
  id: string;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration?: string | null;
  timestamp: number;
  duration: number;
  sourceApp: string | null;
  provider?: string;
  type?: EntryType;
}

export const history$ = observable<Record<string, HistoryEntry>>({});
