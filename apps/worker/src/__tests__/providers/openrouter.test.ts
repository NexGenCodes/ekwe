import { describe, test, expect } from "vitest";
import * as openrouter from "@/providers/openrouter";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("OpenRouter provider", () => {
  describe("stt", () => {
    test("returns result on success", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterTranscriptions, () =>
          jsonResponse({ text: "Hello world", duration: 3.0, language: "en" }),
        ),
      );

      const result = await openrouter.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.text).toBe("Hello world");
      expect(result!.provider).toBe("openrouter");
      expect(result!.duration).toBe(3.0);
    });

    test("returns null on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterTranscriptions, () =>
          jsonResponse({ error: "unauthorized" }, 401),
        ),
      );
      const result = await openrouter.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on hallucination", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterTranscriptions, () =>
          jsonResponse({ text: "Thanks for watching", duration: 1.0 }),
        ),
      );
      const result = await openrouter.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });

  describe("translate", () => {
    test("returns translation on success and sends referer/title headers", async () => {
      let seenHeaders: Record<string, string> = {};
      server.use(
        http.post(PROVIDER_URLS.openrouterChat, ({ request }) => {
          seenHeaders = Object.fromEntries(request.headers.entries());
          return jsonResponse({
            choices: [{ message: { content: "Hola mundo" } }],
          });
        }),
      );

      const result = await openrouter.translate(
        "Hello world",
        "Spanish",
        "English",
        mockEnv(),
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.translation).toBe("Hola mundo");
      expect(result!.provider).toBe("openrouter");
      expect(seenHeaders["http-referer"]).toBe("https://ekwe.pages.dev");
      expect(seenHeaders["x-title"]).toBe("Ekwe");
    });

    test("returns null on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterChat, () =>
          jsonResponse({ error: "unauthorized" }, 401),
        ),
      );
      const result = await openrouter.translate(
        "Hello",
        "Spanish",
        "English",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on empty choices", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterChat, () =>
          jsonResponse({ choices: [] }),
        ),
      );
      const result = await openrouter.translate(
        "Hello",
        "Spanish",
        "English",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });
});
