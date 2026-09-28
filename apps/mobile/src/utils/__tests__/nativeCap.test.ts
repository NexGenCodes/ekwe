import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MAX_AUDIO_BYTES } from "@ekwe/shared/plans";

const cap = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../modules/ekwe-native/native-cap.json"),
    "utf8",
  ),
) as { maxAudioBytes: number };

describe("native upload cap snapshot", () => {
  it("matches the shared plan limit the app enforces", () => {
    expect(cap.maxAudioBytes).toBe(MAX_AUDIO_BYTES);
  });
});
