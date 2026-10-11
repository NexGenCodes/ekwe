import { describe, test, expect } from "vitest";
import * as gemini from "@/providers/gemini";
import { mockEnv, jsonResponse, mockSignal } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("Gemini provider", () => {
  test("returns translation on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () =>
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hola mundo" }] } }],
        }),
      ),
    );

    const result = await gemini.ttt(
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
    expect(result!.provider).toBe("gemini");
  });

  test("returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () =>
        jsonResponse({ error: { message: "quota exceeded" } }, 429),
      ),
    );
    const result = await gemini.ttt(
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

  test("returns null on empty candidates", async () => {
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () =>
        jsonResponse({ candidates: [] }),
      ),
    );
    const result = await gemini.ttt(
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

  test("returns null on missing content parts", async () => {
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, () =>
        jsonResponse({ candidates: [{ content: {} }] }),
      ),
    );
    const result = await gemini.ttt(
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
