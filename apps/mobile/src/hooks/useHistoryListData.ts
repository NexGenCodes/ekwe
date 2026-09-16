import { useMemo } from "react";

import type { HistoryEntry } from "@/store";

type ListItem =
  | { type: "header"; title: string; count: number }
  | { type: "entry"; entry: HistoryEntry };

interface UseHistoryListDataProps {
  isGrouped: boolean;
  entries: HistoryEntry[];
  filteredEntries: HistoryEntry[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Mon, Sep 15" — absolute day header for the recent (sub-6-month) window. */
function formatDayHeader(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${
    MONTHS_SHORT[d.getMonth()]
  } ${d.getDate()}`;
}

/** "August 2026" — collapsed header for old, sparse cloud-tier entries. */
function formatMonthHeader(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Resolves the display header for an entry set at `now`. Recent entries get
 * per-day headers (Today / Yesterday / absolute date); entries older than
 * ~6 months collapse to one header per calendar month — matching the app
 * pattern of a dense 7-day local window followed by sparse cloud history.
 */
function headerFor(ts: number, now: number): string {
  const entryStart = startOfDay(ts);
  const todayStart = startOfDay(now);

  if (entryStart === todayStart) return "Today";
  if (entryStart === todayStart - MS_PER_DAY) return "Yesterday";

  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (ts >= sixMonthsAgo.getTime()) return formatDayHeader(ts);

  return formatMonthHeader(ts);
}

/**
 * Computes and groups history entries into display list items.
 *
 * Grouping is calendar-day based (WhatsApp/Messages pattern): "Today",
 * "Yesterday", then absolute dates; entries older than ~6 months merge into
 * month headers so years of sparse cloud rows don't produce one-item day
 * groups. Newest first — `now` is fixed per render so headers don't flicker
 * across the Today/Yesterday boundary while scrolling.
 */
export function useHistoryListData({
  isGrouped,
  entries,
  filteredEntries,
}: UseHistoryListDataProps): ListItem[] {
  return useMemo((): ListItem[] => {
    if (!isGrouped) {
      return filteredEntries.map((e) => ({ type: "entry" as const, entry: e }));
    }

    const now = Date.now();
    const buckets: ListItem[] = [];
    let current: { title: string; items: HistoryEntry[] } | null = null;

    for (const e of entries) {
      const title = headerFor(e.timestamp, now);
      if (!current || current.title !== title) {
        if (current) {
          buckets.push({
            type: "header",
            title: current.title,
            count: current.items.length,
          });
          for (const item of current.items) {
            buckets.push({ type: "entry", entry: item });
          }
        }
        current = { title, items: [] };
      }
      current.items.push(e);
    }

    if (current) {
      buckets.push({
        type: "header",
        title: current.title,
        count: current.items.length,
      });
      for (const item of current.items) {
        buckets.push({ type: "entry", entry: item });
      }
    }

    return buckets;
  }, [isGrouped, entries, filteredEntries]);
}

export type { ListItem };
