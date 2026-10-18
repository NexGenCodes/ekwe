import { describe, expect, it } from "vitest";

import { FALLBACK_ORIGIN, isHistoryOrigin } from "@ekwe/shared";

import { TELEMETRY_SOURCES } from "@/types/telemetry";

/**
 * The invariant that keeps renaming a surface from breaking dashboards: the
 * telemetry vocabulary is a separate, frozen contract, so a domain rename
 * cannot move a reporting key.
 */
describe("TelemetrySource", () => {
  it("keeps the studio key while the origin was renamed to speech-studio", () => {
    // The surface shows as "Studio" and its origin is "speech-studio", but
    // `result_shared` dashboards key on "studio" and must not be touched.
    expect(isHistoryOrigin("speech-studio")).toBe(true);
    expect(TELEMETRY_SOURCES).toContain("studio");
    expect(TELEMETRY_SOURCES).not.toContain("speech-studio" as never);
  });

  it("does not overlap the retired origin value", () => {
    // "studio" is still a valid *telemetry* key while it is no longer a valid
    // *origin*. The two vocabularies are intentionally allowed to diverge.
    expect(isHistoryOrigin("studio")).toBe(false);
    const sources: readonly string[] = TELEMETRY_SOURCES;
    expect(sources).toContain("studio");
  });

  it("falls back to echo for an unrecognised origin", () => {
    expect(FALLBACK_ORIGIN).toBe("echo");
    expect(isHistoryOrigin(FALLBACK_ORIGIN)).toBe(true);
  });
});
