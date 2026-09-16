import { describe, expect, it } from "vitest";
import { getLimits } from "@/core/limits";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@ekwe/shared";

describe("getLimits", () => {
  it("returns FREE_LIMITS for FREE tier", () => {
    expect(getLimits("FREE")).toBe(FREE_LIMITS);
  });

  it("returns PREMIUM_LIMITS for PREMIUM tier", () => {
    expect(getLimits("PREMIUM")).toBe(PREMIUM_LIMITS);
  });
});
