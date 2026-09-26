import { resolveVoiceGender, resolveVoiceSelection } from "@/utils/voices";

describe("resolveVoiceSelection", () => {
  it("returns Standard/female when nothing is selected", () => {
    const selection = resolveVoiceSelection(null, null);
    expect(selection.slot.id).toBe("standard");
    expect(selection.gender).toBe("female");
  });

  it("keeps the slot and the gender independent", () => {
    const male = resolveVoiceSelection("standard", "male");
    const female = resolveVoiceSelection("standard", "female");
    expect(male.slot.id).toBe("standard");
    expect(female.slot.id).toBe("standard");
    expect(male.gender).toBe("male");
    expect(female.gender).toBe("female");
  });

  it("resolves Studio in either gender", () => {
    const male = resolveVoiceSelection("studio", "male");
    const female = resolveVoiceSelection("studio", "female");
    expect(male.slot.id).toBe("studio");
    expect(male.slot.tier).toBe("pro");
    expect(male.gender).toBe("male");
    expect(female.gender).toBe("female");
  });

  it("falls back to Standard for an unknown or missing slot id", () => {
    expect(resolveVoiceSelection("not-a-real-id", "female").slot.id).toBe(
      "standard",
    );
    expect(resolveVoiceSelection(undefined, "male").slot.id).toBe("standard");
  });

  it("treats the 'default' gender setting as unset, not as an error", () => {
    const selection = resolveVoiceSelection("studio", "default");
    expect(selection.gender).toBe("female");
    expect(selection.slot.id).toBe("studio");
  });
});

describe("resolveVoiceGender", () => {
  it("maps concrete genders through and unwraps non-gender settings", () => {
    expect(resolveVoiceGender("male")).toBe("male");
    expect(resolveVoiceGender("female")).toBe("female");
    expect(resolveVoiceGender("default")).toBe("female");
    expect(resolveVoiceGender(null)).toBe("female");
    expect(resolveVoiceGender(undefined)).toBe("female");
  });
});
