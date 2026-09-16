import { describe, expect, it } from "vitest";
import {
  getTranscribeProviderNames,
  getTranslateProviderNames,
  getStreamingProviderNames,
  getTtsProviderNames,
  ttsProviderSupports,
} from "@/core/config";

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

  it("getTtsProviderNames returns premium TTS pipeline", () => {
    const tts = getTtsProviderNames();
    expect(tts.length).toBeGreaterThan(0);
  });
});

describe("ttsProviderSupports", () => {
  it("returns true for provider supporting 'all'", () => {
    expect(ttsProviderSupports("gemini", "en")).toBe(true);
    expect(ttsProviderSupports("gemini", "xyz")).toBe(true);
  });

  it("returns true for supported language and false for unsupported", () => {
    expect(ttsProviderSupports("aura2", "en")).toBe(true);
    expect(ttsProviderSupports("aura2", "fr")).toBe(false);
  });

  it("returns false for unknown provider", () => {
    expect(ttsProviderSupports("unknown_provider", "en")).toBe(false);
  });
});
