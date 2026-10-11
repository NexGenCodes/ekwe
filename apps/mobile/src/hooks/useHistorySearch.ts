import { useState, useEffect, useMemo } from "react";

import { Db } from "@/services/db";
import { historyRowToEntry } from "@/services/historyMapper";
import { auth$, HistoryEntry } from "@/store";
import logger from "@/utils/logger";

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
  /** A search is in flight and has no rows for the current query yet. */
  isSearchPending: boolean;
}

export function useHistorySearch(entries: HistoryEntry[]): HistorySearchState {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilterOption>("all");
  // Keyed by the query that produced them: `isSearching` flips the moment the
  // debounced query is non-empty, so unkeyed results would put the previous
  // query's rows on screen under the new one while the search ran.
  const [searchResults, setSearchResults] = useState<{
    query: string;
    entries: HistoryEntry[];
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY_MS);
    return (): void => clearTimeout(t);
  }, [query]);

  const trimmedQuery = debouncedQuery.trim();
  const isSearching = trimmedQuery.length > 0;

  /**
   * Search runs in an effect rather than in render: an FTS query in a memo
   * re-runs whenever `entries` changes identity, which re-scanned the index on
   * every history update even with an unchanged query.
   */
  useEffect(() => {
    const userId = auth$.user.get()?.id;
    if (trimmedQuery.length === 0 || !userId) {
      setSearchResults(null);
      return;
    }

    let cancelled = false;
    void Db.searchHistoryAsync(userId, trimmedQuery, 200).then(
      (rows) => {
        if (cancelled) return;
        setSearchResults({
          query: trimmedQuery,
          entries: rows.map(rowToEntry),
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        logger.warn("[history] Search failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        setSearchResults({ query: trimmedQuery, entries: [] });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [trimmedQuery]);

  const results =
    searchResults?.query === trimmedQuery ? searchResults.entries : null;
  const isSearchPending = isSearching && results === null;

  const filteredEntries = useMemo(() => {
    const list = isSearching ? (results ?? []) : entries;
    return filter === "all" ? list : list.filter((e) => e.origin === filter);
  }, [entries, isSearching, results, filter]);

  return {
    query,
    setQuery,
    debouncedQuery,
    filter,
    setFilter,
    filteredEntries,
    isSearching,
    isSearchPending,
  };
}
