/**
 * Outbox payloads are the exact wire row to push, so the drain never has to
 * reconstruct what a write looked like from a partial record.
 */

import { historyRowSchema } from "@ekwe/shared";
import type { HistoryRow as WireHistoryRow } from "@ekwe/shared";

export function serializeOutboxRow(row: WireHistoryRow): string {
  return JSON.stringify(row);
}

/** Returns null for a payload that predates this schema or is corrupt. */
export function parseOutboxRow(payload: string): WireHistoryRow | null {
  try {
    const parsed = historyRowSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
