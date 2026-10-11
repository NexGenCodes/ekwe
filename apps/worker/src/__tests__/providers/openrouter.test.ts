import { describe, test, expect } from "vitest";
import * as openrouter from "@/providers/openrouter";
import { mockEnv, jsonResponse, mockSignal } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("OpenRouter provider", () => {
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

      const result = await openrouter.ttt(
        "Hello world",
        {
          targetLang: "es",
          sourceLang: "en",
          transliteration: false,
        },
        mockEnv(),
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.translation).toBe("Hola mundo");
      expect(result!.provider).toBe("openrouter");
      expect(seenHeaders["http-referer"]).toBe("https://ekwe.pages.dev");
      expect(seenHeaders["x-title"]).toBe("Ekwe");
    });

    test("throws on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterChat, () =>
          jsonResponse({ error: "unauthorized" }, 401),
        ),
      );
      await expect(
        openrouter.ttt(
          "Hello",
          {
            targetLang: "es",
            sourceLang: "en",
            transliteration: false,
          },
          mockEnv(),
          mockSignal(),
        ),
      ).rejects.toThrow();
    });

    test("returns null on empty choices", async () => {
      server.use(
        http.post(PROVIDER_URLS.openrouterChat, () =>
          jsonResponse({ choices: [] }),
        ),
      );
      const result = await openrouter.ttt(
        "Hello",
        {
          targetLang: "es",
          sourceLang: "en",
          transliteration: false,
        },
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });
});
