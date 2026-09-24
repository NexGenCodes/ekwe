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

function formatDayHeader(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${
    MONTHS_SHORT[d.getMonth()]
  } ${d.getDate()}`;
}

function formatMonthHeader(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

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
