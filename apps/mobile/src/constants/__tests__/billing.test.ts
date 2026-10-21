import {
  HISTORY_TTL_FREE_DAYS,
  HISTORY_TTL_PAID_DAYS,
} from "@ekwe/shared/retention";
import { describe, expect, it } from "vitest";

import { BILLING_PLANS } from "@/constants/billing";

const titles = (plan: { features: readonly { title: string }[] }): string[] =>
  plan.features.map((feature) => feature.title);

describe("BILLING_PLANS history copy", () => {
  it("matches the free cloud retention window", () => {
    expect(titles(BILLING_PLANS.free)).toContain(
      `${HISTORY_TTL_FREE_DAYS}-day cloud history`,
    );
  });

  it("matches the pro cloud retention window", () => {
    expect(titles(BILLING_PLANS.pro)).toContain(
      `${HISTORY_TTL_PAID_DAYS}-day cloud history`,
    );
  });

  it("omits rows that are identical across plans or internal", () => {
    const free = titles(BILLING_PLANS.free);
    const pro = titles(BILLING_PLANS.pro);

    for (const copy of free.concat(pro)) {
      expect(copy).not.toContain("on-device history");
      expect(copy).not.toContain("selected languages");
      expect(copy).not.toContain("Preview every voice");
      expect(copy).not.toContain("cooldown");
    }
  });
});
