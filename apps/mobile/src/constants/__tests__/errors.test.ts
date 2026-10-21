import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared";
import { describe, expect, it } from "vitest";

import { EkweError, ErrorMessages } from "@/constants/errors";

describe("billing limit error copy", () => {
  it("states both the free and pro audio upload caps", () => {
    const message = ErrorMessages[EkweError.FILE_TOO_LARGE];
    const freeMb = Math.round(FREE_LIMITS.maxAudioBytes / 1_048_576);
    const proMb = Math.round(PREMIUM_LIMITS.maxAudioBytes / 1_048_576);

    expect(message).toContain(`${freeMb}MB`);
    expect(message).toContain(`${proMb}MB`);
  });

  it("derives audio duration copy from the real plan limits", () => {
    const message = ErrorMessages[EkweError.AUDIO_TOO_LONG];
    const freeMin = Math.round(FREE_LIMITS.dictationDurationMs / 60_000);
    const proMin = Math.round(PREMIUM_LIMITS.dictationDurationMs / 60_000);

    expect(message).toContain(`${freeMin} min`);
    expect(message).toContain(`${proMin} min`);
  });
});
