import { useState, useEffect, useMemo } from "react";

import { Db } from "@/services/db";
import { auth$, EntryType, HistoryEntry } from "@/store";

const DEBOUNCE_DELAY_MS = 300;
export type HistoryFilterOption = "all" | "transcription" | "translation";

/**
 * Returns the producing operation of a history entry: the persisted `type`
 * when set, falling back to a content-derived estimate for legacy rows.
 *
 * A user either transcribes or translates — never both at once. An entry that
 * was transcribed and then translated keeps type "transcription"; the presence
 * of a distinct translation is a derived "translated" state, not a third type.
 */
export function getEntryType(entry: HistoryEntry): EntryType {
  if (entry.type === "transcription" || entry.type === "translation") {
    return entry.type;
  }
  const hasDistinctTranslation =
    !!entry.translation?.trim() &&
    entry.translation.trim() !== entry.transcript?.trim();
  return hasDistinctTranslation ? "translation" : "transcription";
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
  entry_type?: EntryType;
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
    type: row.entry_type,
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
    const userId = auth$.user.get()?.id;
    let list = entries;
    if (debouncedQuery.trim().length > 0 && userId) {
      const rows = Db.searchHistory(userId, debouncedQuery, 200);
      list = rows.map(rowToEntry);
    }

    if (filter === "transcription") {
      // Producing operation was transcription (audio → text)
      list = list.filter((e) => getEntryType(e) === "transcription");
    } else if (filter === "translation") {
      // Producing operation was translation (text → text)
      list = list.filter((e) => getEntryType(e) === "translation");
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
