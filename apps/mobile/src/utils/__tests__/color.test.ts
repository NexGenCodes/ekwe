import { withAlpha } from "@/utils/color";

describe("withAlpha", () => {
  it("appends hex alpha to a color string", () => {
    expect(withAlpha("#006FEE", 0)).toBe("#006FEE00");
    expect(withAlpha("#006FEE", 1)).toBe("#006FEEff");
    expect(withAlpha("#006FEE", 0.5)).toBe("#006FEE80");
    expect(withAlpha("#006FEE", 0.15)).toBe("#006FEE26");
  });

  it("clamps alpha out-of-range", () => {
    expect(withAlpha("#000000", -1)).toBe("#00000000");
    expect(withAlpha("#000000", 2)).toBe("#000000ff");
  });
});
