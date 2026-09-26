import { describe, it, expect } from "vitest";

import {
  HISTORY_ORIGINS,
  ORIGIN_META,
  FALLBACK_ORIGIN,
  isHistoryOrigin,
} from "@ekwe/shared";

describe("ORIGIN_META", () => {
  it("describes every origin", () => {
    for (const origin of HISTORY_ORIGINS) {
      expect(ORIGIN_META[origin].label).toBeTruthy();
      expect(ORIGIN_META[origin].description).toBeTruthy();
      expect(ORIGIN_META[origin].icon).toBeTruthy();
    }
  });
});

describe("isHistoryOrigin", () => {
  it("accepts the known origins", () => {
    for (const origin of HISTORY_ORIGINS) {
      expect(isHistoryOrigin(origin)).toBe(true);
    }
  });

  it("rejects anything else, including a missing column default", () => {
    // A row written before the column existed carries the database default,
    // which is a real string but not a real origin.
    expect(isHistoryOrigin("echo ")).toBe(false);
    expect(isHistoryOrigin("transcription")).toBe(false);
    expect(isHistoryOrigin("")).toBe(false);
    expect(isHistoryOrigin(null)).toBe(false);
    expect(isHistoryOrigin(undefined)).toBe(false);
    expect(isHistoryOrigin(42)).toBe(false);
  });
});

describe("FALLBACK_ORIGIN", () => {
  it("is echo, the only surface that wrote history before the column landed", () => {
    // The column was added as NOT NULL DEFAULT 'echo', so every row that
    // predates it was backfilled with exactly this value and no fallback map
    // could ever have been reached for a stored row.
    expect(FALLBACK_ORIGIN).toBe("echo");
    expect(HISTORY_ORIGINS).toContain(FALLBACK_ORIGIN);
  });
});

describe("isHistoryOrigin", () => {
  it("rejects the retired studio value", () => {
    // Renamed to speech-studio. Anything still sending the old value now falls
    // back rather than silently filing itself as Speech Studio.
    expect(isHistoryOrigin("studio")).toBe(false);
  });
});
