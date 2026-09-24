import {
  resolveActiveVoice,
  resolveVoiceGender,
  voiceIdForGender,
} from "@/utils/voices";

describe("resolveActiveVoice", () => {
  it("returns the Standard voice when nothing is selected", () => {
    const voice = resolveActiveVoice(null, null);
    expect(voice.id).toBe("standard");
    expect(voice.gender).toBe("female");
  });

  it("pins Standard's gender to the selected voiceGender", () => {
    const male = resolveActiveVoice("standard", "male");
    const female = resolveActiveVoice("standard", "female");
    expect(male.gender).toBe("male");
    expect(female.gender).toBe("female");
    expect(male.id).toBe("standard");
  });

  it("keeps studio voices on their own fixed gender", () => {
    const voice = resolveActiveVoice("studio-male-1", "female");
    expect(voice.id).toBe("studio-male-1");
    expect(voice.gender).toBe("male");
  });

  it("resolves the gender-only path to Standard with the matching gender", () => {
    const voice = resolveActiveVoice(null, "male");
    expect(voice.id).toBe("standard");
    expect(voice.gender).toBe("male");
  });

  it("falls back to Standard for an unknown voiceId", () => {
    const voice = resolveActiveVoice("not-a-real-id", "female");
    expect(voice.id).toBe("standard");
  });
});

describe("resolveVoiceGender", () => {
  it("maps concrete genders through and unwraps non-gender settings", () => {
    expect(resolveVoiceGender("male")).toBe("male");
    expect(resolveVoiceGender("female")).toBe("female");
    expect(resolveVoiceGender("default")).toBeUndefined();
    expect(resolveVoiceGender(null)).toBeUndefined();
    expect(resolveVoiceGender(undefined)).toBeUndefined();
  });
});

describe("voiceIdForGender", () => {
  it("always maps a gender to the free Standard voice", () => {
    expect(voiceIdForGender("male")).toBe("standard");
    expect(voiceIdForGender("female")).toBe("standard");
    expect(voiceIdForGender("default")).toBe("standard");
  });
});
