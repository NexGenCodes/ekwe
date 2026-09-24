import { describe, expect, it } from "vitest";
import {
  getTranscribeProviderNames,
  getTranslateProviderNames,
  getStreamingProviderNames,
  getSpeechProviderNames,
  speechProviderSupports,
} from "@/core/providers";

describe("config provider pipelines", () => {
  it("getTranscribeProviderNames returns different pipelines for FREE and PREMIUM", () => {
    const free = getTranscribeProviderNames("FREE");
    const premium = getTranscribeProviderNames("PREMIUM");
    expect(free.length).toBeGreaterThan(0);
    expect(premium.length).toBeGreaterThan(0);
    expect(free).not.toEqual(premium);
  });

  it("getTranslateProviderNames returns different pipelines for FREE and PREMIUM", () => {
    const free = getTranslateProviderNames("FREE");
    const premium = getTranslateProviderNames("PREMIUM");
    expect(free.length).toBeGreaterThan(0);
    expect(premium.length).toBeGreaterThan(0);
    expect(free).not.toEqual(premium);
  });

  it("getStreamingProviderNames returns streaming pipeline", () => {
    const streaming = getStreamingProviderNames();
    expect(streaming.length).toBeGreaterThan(0);
  });

  it("getSpeechProviderNames returns speech pipelines", () => {
    const free = getSpeechProviderNames("FREE");
    const premium = getSpeechProviderNames("PREMIUM");
    expect(free.length).toBeGreaterThan(0);

    expect(free[0]).toBe("edge");
    expect(free[1]).toBe("witai");
    expect(free).not.toContain("openrouter");
    expect(premium[0]).toBe("gemini");
    expect(premium[1]).toBe("deepgram");
    expect(premium).not.toContain("openrouter");
    expect(premium).not.toContain("aura2");
    expect(premium).not.toContain("aura1");
  });
});

describe("speechProviderSupports", () => {
  it("returns true for provider supporting 'all'", () => {
    expect(speechProviderSupports("gemini", "en")).toBe(true);
    expect(speechProviderSupports("gemini", "xyz")).toBe(true);
  });

  it("returns true for supported language and false for unsupported", () => {
    expect(speechProviderSupports("deepgram", "en")).toBe(true);
    expect(speechProviderSupports("deepgram", "fr")).toBe(true);
    expect(speechProviderSupports("deepgram", "ja")).toBe(true);
    expect(speechProviderSupports("deepgram", "zh")).toBe(false);

    expect(speechProviderSupports("witai", "ko")).toBe(true);
    expect(speechProviderSupports("edge", "fr")).toBe(true);
  });

  it("returns false for unknown provider", () => {
    expect(speechProviderSupports("unknown_provider", "en")).toBe(false);
  });
});
