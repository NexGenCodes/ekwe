import { useState, useEffect, useMemo } from "react";

import { Db } from "@/services/db";
import { HistoryEntry } from "@/store";

const DEBOUNCE_DELAY_MS = 300;
export type HistoryFilterOption = "all" | "transcription" | "translation";
export type EntryType = "transcription" | "translation" | "both";

/**
 * Derives the semantic type of a history entry:
 * - transcription: no distinct translation (translation is null, empty, or identical to transcript)
 * - translation:   has a distinct translation but no separate original transcript
 * - both:          has both a transcript and a distinct translation
 */
export function getEntryType(entry: HistoryEntry): EntryType {
  const hasDistinctTranslation =
    !!entry.translation?.trim() &&
    entry.translation.trim() !== entry.transcript?.trim();

  if (!hasDistinctTranslation) return "transcription";

  const hasTranscript = !!entry.transcript?.trim();
  const hasAudio = !!entry.duration && entry.duration > 0;

  if (hasTranscript && hasAudio) return "both";
  return "translation";
}

function rowToEntry(row: {
  id: string;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  transliteration_text: string | null;
  duration: number;
  source_app: string;
  provider: string;
  created_at: string;
  deleted: number;
}): HistoryEntry {
  return {
    id: row.id,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    transcript: row.transcript,
    translation: row.translation_text,
    transliteration: row.transliteration_text,
    duration: row.duration,
    sourceApp: row.source_app,
    provider: row.provider,
    timestamp: new Date(row.created_at).getTime(),
  };
}

export interface HistorySearchState {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  debouncedQuery: string;
  filter: HistoryFilterOption;
  setFilter: React.Dispatch<React.SetStateAction<HistoryFilterOption>>;
  filteredEntries: HistoryEntry[];
  isSearching: boolean;
}

export function useHistorySearch(entries: HistoryEntry[]): HistorySearchState {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilterOption>("all");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY_MS);
    return (): void => clearTimeout(t);
  }, [query]);

  const filteredEntries = useMemo(() => {
    let list = entries;
    if (debouncedQuery.trim().length > 0) {
      const rows = Db.searchHistory(debouncedQuery, 200);
      list = rows.map(rowToEntry);
    }

    if (filter === "transcription") {
      // Transcription: no distinct translation exists
      list = list.filter((e) => getEntryType(e) === "transcription");
    } else if (filter === "translation") {
      // Translation: has a distinct translation (includes 'both' entries)
      list = list.filter((e) => {
        const t = getEntryType(e);
        return t === "translation" || t === "both";
      });
    }

    return list;
  }, [entries, debouncedQuery, filter]);

  const isSearching = debouncedQuery.trim().length > 0;

  return {
    query,
    setQuery,
    debouncedQuery,
    filter,
    setFilter,
    filteredEntries,
    isSearching,
  };
}
