import { observable, computed } from "@legendapp/state";

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

export const sortedHistory$ = computed(() => {
  const keys = Object.keys(history$.get());
  return keys
    .map((key) => history$[key].peek())
    .sort((a, b) => b.timestamp - a.timestamp);
});
