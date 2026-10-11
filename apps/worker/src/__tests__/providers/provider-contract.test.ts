import { describe, it, expect } from "vitest";
import { PROVIDER_MODULES } from "@/providers";

describe("Provider Contract Compliance", () => {
  const providers = Object.values(PROVIDER_MODULES);

  it("should have registered providers", () => {
    expect(providers.length).toBeGreaterThan(0);
  });

  for (const provider of providers) {
    describe(`Provider: ${provider.name}`, () => {
      it("should correctly implement all declared capabilities", () => {
        // If it declares STT, it must provide the STT function
        if (provider.capabilities.includes("stt")) {
          expect(typeof provider.stt).toBe("function");
        }

        // If it declares TTT, it must provide the ttt function
        if (provider.capabilities.includes("ttt")) {
          expect(typeof provider.ttt).toBe("function");
        }

        // If it declares TTS, it must provide both the TTS generator and voice list
        if (provider.capabilities.includes("tts")) {
          expect(typeof provider.tts).toBe("function");
          expect(typeof provider.voices).toBe("function");
        }

        // If it declares streaming STT, it must provide the stream function and declare its routes
        if (provider.capabilities.includes("sttStream")) {
          expect(typeof provider.sttStream).toBe("function");
          expect(Array.isArray(provider.streamRoutes)).toBe(true);
          expect(provider.streamRoutes!.length).toBeGreaterThan(0);
        }
      });

      it("should not export functions for capabilities it does not declare", () => {
        if (!provider.capabilities.includes("stt")) {
          expect(provider.stt).toBeUndefined();
        }

        if (!provider.capabilities.includes("ttt")) {
          expect(provider.ttt).toBeUndefined();
        }

        if (!provider.capabilities.includes("tts")) {
          expect(provider.tts).toBeUndefined();
          expect(provider.voices).toBeUndefined();
        }

        if (!provider.capabilities.includes("sttStream")) {
          expect(provider.sttStream).toBeUndefined();
        }
      });
    });
  }
});
