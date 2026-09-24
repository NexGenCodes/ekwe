import { useState, useEffect, useMemo } from "react";

import { Db } from "@/services/db";
import { auth$, EntryType, HistoryEntry } from "@/store";

const DEBOUNCE_DELAY_MS = 300;
export type HistoryFilterOption = "all" | "transcription" | "translation";

export function getEntryType(entry: HistoryEntry): EntryType {
  if (entry.type === "transcription" || entry.type === "translation") {
    return entry.type;
  }
  const hasDistinctTranslation =
    !!entry.translation?.trim() &&
    entry.translation.trim() !== entry.transcript?.trim();
  return hasDistinctTranslation ? "translation" : "transcription";
}

import type { HistoryRow } from "@/services/db";

function rowToEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    transcript: row.transcript,
    translation: row.translationText,
    transliteration: row.transliterationText,
    duration: row.duration,
    sourceApp: row.sourceApp,
    provider: row.provider ?? "",
    timestamp: new Date(row.createdAt).getTime(),
    type: (row.entryType as EntryType) ?? "transcription",
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
      list = list.filter((e) => getEntryType(e) === "transcription");
    } else if (filter === "translation") {
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
