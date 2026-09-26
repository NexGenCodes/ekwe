/**
 * Frozen telemetry vocabulary.
 *
 * These values are a reporting contract: dashboards, filters and saved
 * queries key on them. They are deliberately NOT the same union as
 * `HistoryOrigin`, even where the words match.
 *
 * When a product surface is renamed, its telemetry key must not move with it.
 * That decoupling is the whole reason this type exists: `HistoryOrigin` is a
 * domain enum free to be renamed at any time, while `TelemetrySource` is only
 * ever added to. Renaming a domain value is a refactor; renaming a telemetry
 * value is a data migration with no code benefit.
 *
 * See docs/naming.md.
 */
export type TelemetrySource = "studio" | "echo" | "history" | "result";

/** Every value, for exhaustive checks in tests. */
export const TELEMETRY_SOURCES = [
  "studio",
  "echo",
  "history",
  "result",
] as const satisfies readonly TelemetrySource[];
