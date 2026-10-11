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

describe("edit re-render cost", () => {
  /**
   * `synthesizeSpeech` treats a present `sourceLang` as "translate this" and an
   * omitted one as "speak this". The editor only wants the former when the app
   * misheard the user and the translation must follow the correction; every
   * other edit is text the user has already written the final wording for, and
   * translating it would charge them for a translation of their own words.
   *
   * The decision itself is covered behaviourally in
   * `components/home/__tests__/editPlan.test.ts` — this block is kept only for
   * the reasoning, which should survive the next refactor of the editor.
   */
  const needsTranslate = (
    sourceLang: string | undefined,
    targetLang: string,
  ): boolean =>
    sourceLang !== undefined &&
    sourceLang !== "auto" &&
    sourceLang !== targetLang;

  it("translates when a source language is supplied", () => {
    expect(needsTranslate("en", "fr")).toBe(true);
  });

  it("skips translation when the source language is omitted, as a speak-only render does", () => {
    expect(needsTranslate(undefined, "fr")).toBe(false);
  });
});
