/**
 * History is an archive of *text* Ekwe understood, tagged by which capture
 * surface understood it. Audio is never stored: it is a rendering of text we
 * already hold, regenerable on demand, and keeping it would cost storage on
 * every surface for no retrievable benefit.
 *
 * The three surfaces are distinguished by `origin` — the product feature that
 * produced the entry — not by what was done to it. A capture that was later
 * translated is still the same capture, so translation is a nullable field on
 * the row rather than a category of row.
 */
export type HistoryOrigin = "speech-studio" | "echo" | "orb";

/** What the surface consumed: recorded audio, or text the user typed. */
export type HistoryInput = "audio" | "text";

export interface OriginMeta {
  readonly label: string;
  /** Shown in empty states and the origin filter's accessibility hint. */
  readonly description: string;
  /** lucide-react-native icon name, resolved by the presenting component. */
  readonly icon: "mic" | "share-2" | "circle-dot";
}

export const HISTORY_ORIGINS = ["speech-studio", "echo", "orb"] as const;

/**
 * `label` is display-only and may be shortened freely; the origin *value* is
 * persisted on every history row and is frozen. Renaming it would orphan
 * existing entries and break the `result_shared` dashboards, which key on the
 * separate `TELEMETRY_SOURCES` vocabulary.
 */
export const ORIGIN_META: Record<HistoryOrigin, OriginMeta> = {
  "speech-studio": {
    label: "Studio",
    description: "Recorded or typed in Ekwe",
    icon: "mic",
  },
  echo: {
    label: "Echo",
    description: "Shared into Ekwe from another app",
    icon: "share-2",
  },
  orb: {
    label: "Orb",
    description: "Transcribed while playing in another app",
    icon: "circle-dot",
  },
};

export function isHistoryOrigin(value: unknown): value is HistoryOrigin {
  return (
    typeof value === "string" &&
    (HISTORY_ORIGINS as readonly string[]).includes(value)
  );
}

/**
 * The origin to assume when a row carries none we recognise.
 *
 * There is deliberately no `source_app` fallback map any more. The migration
 * that introduced the column declared it `NOT NULL DEFAULT 'echo'`, so every
 * row that predates the column was backfilled with a value that is already
 * valid — a `source_app` map could never be reached for a stored row, and its
 * only reachable keys all resolved to `echo` anyway. It was dead weight that
 * looked load-bearing.
 */
export const FALLBACK_ORIGIN: HistoryOrigin = "echo";
