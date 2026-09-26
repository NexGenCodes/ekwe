import { useState, useEffect, useMemo } from "react";

import { Db } from "@/services/db";
import { historyRowToEntry } from "@/services/historyMapper";
import { auth$, HistoryEntry } from "@/store";

const DEBOUNCE_DELAY_MS = 300;

/**
 * History is filtered by capture surface rather than by what was done to the
 * entry. Every row is one capture, so whether it carries a translation is
 * visible on the row itself and needs no filter of its own.
 */
export type HistoryFilterOption = "all" | "speech-studio" | "echo" | "orb";

export function hasTranslation(entry: HistoryEntry): boolean {
  return (
    !!entry.translation?.trim() &&
    entry.translation.trim() !== entry.transcript?.trim()
  );
}

import type { HistoryRow } from "@/services/db";

function rowToEntry(row: HistoryRow): HistoryEntry {
  return historyRowToEntry(row);
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

    if (filter !== "all") {
      list = list.filter((e) => e.origin === filter);
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
