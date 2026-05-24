import { observable } from '@legendapp/state';

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
  deleted?: boolean;
}

export const history$ = observable<Record<string, HistoryEntry>>({});
