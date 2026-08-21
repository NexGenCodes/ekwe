import { VoiceQuality, type Voice } from "expo-speech";

import {
  inferVoiceGender,
  isMissingVoiceError,
  pickDeviceVoice,
} from "../deviceVoice";

const makeVoice = (overrides: Partial<Voice>): Voice => ({
  identifier: "voice-1",
  name: "Test Voice",
  quality: VoiceQuality.Default,
  language: "en-US",
  ...overrides,
});

describe("inferVoiceGender", () => {
  it("detects female from Android engine identifier tokens", () => {
    expect(
      inferVoiceGender(
        makeVoice({ identifier: "com.google.android.tts#female_1" }),
      ),
    ).toBe("female");
  });

  it("detects male from Android engine name tokens", () => {
    expect(inferVoiceGender(makeVoice({ name: "English (US) Male 2" }))).toBe(
      "male",
    );
  });

  it("treats 'female' before 'male' so the substring never wins", () => {
    expect(
      inferVoiceGender(makeVoice({ name: "Google UK English Female" })),
    ).toBe("female");
  });

  it("recognizes curated iOS female voice names", () => {
    expect(inferVoiceGender(makeVoice({ name: "Samantha" }))).toBe("female");
    expect(inferVoiceGender(makeVoice({ name: "Zosia" }))).toBe("female");
  });

  it("recognizes curated iOS male voice names", () => {
    expect(inferVoiceGender(makeVoice({ name: "Daniel" }))).toBe("male");
    expect(inferVoiceGender(makeVoice({ name: "Alex" }))).toBe("male");
  });

  it("is case-insensitive", () => {
    expect(inferVoiceGender(makeVoice({ name: "samantha" }))).toBe("female");
  });

  it("returns null for unclassifiable voices", () => {
    expect(inferVoiceGender(makeVoice({ name: "Google Deutsch" }))).toBe(null);
    expect(
      inferVoiceGender(
        makeVoice({
          identifier: "-en-us-x-aph-network",
          name: "Network voice",
        }),
      ),
    ).toBe(null);
  });
});

describe("pickDeviceVoice", () => {
  const femaleEnUs = makeVoice({
    identifier: "en-us-female",
    name: "Samantha",
    quality: VoiceQuality.Enhanced,
    language: "en-US",
  });
  const maleEnUs = makeVoice({
    identifier: "en-us-male",
    name: "Daniel",
    quality: VoiceQuality.Enhanced,
    language: "en-US",
  });
  const unclassifiedEnUs = makeVoice({
    identifier: "en-us-x-aph",
    name: "Google US English",
    language: "en-US",
  });
  const unclassifiedEnGb = makeVoice({
    identifier: "en-gb-x-aph",
    name: "Google UK English",
    language: "en-GB",
  });
  const femaleFr = makeVoice({
    identifier: "fr-female",
    name: "Amelie",
    language: "fr-FR",
  });

  it("picks the gender-matched voice for the language", () => {
    expect(
      pickDeviceVoice([maleEnUs, femaleEnUs], "en", "female"),
    ).toMatchObject({ identifier: "en-us-female" });
    expect(pickDeviceVoice([maleEnUs, femaleEnUs], "en", "male")).toMatchObject(
      { identifier: "en-us-male" },
    );
  });

  it("falls back to an unclassified voice when no gender match exists", () => {
    expect(
      pickDeviceVoice([unclassifiedEnUs, femaleFr], "en", "male"),
    ).toMatchObject({ identifier: "en-us-x-aph" });
  });

  it("returns undefined when only gender-mismatched voices exist", () => {
    expect(pickDeviceVoice([maleEnUs], "en", "female")).toBeUndefined();
  });

  it("prefers gender match over quality for the same language", () => {
    const lowQualityFemale = makeVoice({
      identifier: "en-us-female-low",
      name: "Samantha",
      language: "en-US",
    });
    expect(
      pickDeviceVoice([unclassifiedEnUs, lowQualityFemale], "en", "female"),
    ).toMatchObject({ identifier: "en-us-female-low" });
  });

  it("prefers enhanced quality among unclassified voices", () => {
    const enhancedUnclassified = makeVoice({
      identifier: "en-us-enhanced",
      name: "Google US English",
      quality: VoiceQuality.Enhanced,
      language: "en-US",
    });
    expect(
      pickDeviceVoice([unclassifiedEnUs, enhancedUnclassified], "en", "male"),
    ).toMatchObject({ identifier: "en-us-enhanced" });
  });

  it("prefers the exact region match over the same-language voice", () => {
    expect(
      pickDeviceVoice([unclassifiedEnGb, unclassifiedEnUs], "en-US", "male"),
    ).toMatchObject({ identifier: "en-us-x-aph" });
  });

  it("returns undefined when no voices exist for the language", () => {
    expect(pickDeviceVoice([femaleFr], "en", "female")).toBeUndefined();
  });

  it("matches language codes case-insensitively", () => {
    const lower = makeVoice({
      identifier: "en-lower",
      name: "Samantha",
      language: "en-us",
    });
    expect(pickDeviceVoice([lower], "EN", "female")).toMatchObject({
      identifier: "en-lower",
    });
  });
});

describe("isMissingVoiceError", () => {
  it("matches missing-voice and synthesis failures", () => {
    expect(isMissingVoiceError("No voice found for the language")).toBe(true);
    expect(isMissingVoiceError("The selected voice is not installed")).toBe(
      true,
    );
    expect(isMissingVoiceError("TextToSpeech synthesis failed")).toBe(true);
    expect(isMissingVoiceError("language not supported by the engine")).toBe(
      true,
    );
  });

  it("ignores interruptions, stops, and generic failures", () => {
    expect(isMissingVoiceError("speech was interrupted")).toBe(false);
    expect(isMissingVoiceError("TTS stopped")).toBe(false);
    expect(isMissingVoiceError("Generic failure")).toBe(false);
  });
});
