import { describe, test, expect, vi } from "vitest";

// franc is a statistical guess, so the wrong-language case is driven from here
// rather than by hunting for a sentence it happens to be sure about. What is
// under test is the wiring: the pipeline must consult the validator and move on
// when it says no.
const validateTranscriptLanguage = vi.fn<(t: string, l?: string) => boolean>();
vi.mock("@/services/auto-detect", () => ({
  detectTextLanguage: vi.fn(async () => "en"),
  validateTranscriptLanguage: (t: string, l?: string) =>
    validateTranscriptLanguage(t, l),
}));

import { runTranslate } from "@/services/translate";
import { mockEnv, jsonResponse } from "@/__tests__/setup";
import { ROMANIZATION_MARKER } from "@/utils/prompts";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import type { Env, Tier } from "@/core/types";

const TRANSLATION = "El zorro marrón salta sobre el perro perezoso";

function job(over: Partial<Parameters<typeof runTranslate>[0]> = {}) {
  return {
    env: mockEnv() as Env,
    tier: "PREMIUM" as Tier,
    signal: new AbortController().signal,
    text: "The quick brown fox jumps over the lazy dog",
    sourceLang: "en",
    targetLang: "es",
    wantTransliteration: false,
    budgetMs: 10_000,
    ...over,
  };
}

describe("runTranslate", () => {
  test("rejects a provider the validator refuses and tries the next", async () => {
    // Synthesis used to skip this check entirely, so a provider that answered in
    // the wrong language was cached and served from D1 from then on.
    validateTranscriptLanguage.mockImplementation((t) => t !== TRANSLATION);
    server.use(
      http.post(PROVIDER_URLS.geminiGenerate, async ({ request }) => {
        await request.text();
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: TRANSLATION }],
              },
            },
          ],
        });
      }),
      http.post(PROVIDER_URLS.cohereChat, async ({ request }) => {
        await request.text();
        return jsonResponse({
          message: { content: [{ type: "text", text: "Hola mundo" }] },
        });
      }),
    );

    const result = await runTranslate(job());

    expect(validateTranscriptLanguage).toHaveBeenCalled();
    // Gemini leads the premium pool and answers in the wrong language, so the
    // job must fall through to the next provider rather than cache it.
    expect(result?.translation).toBe("Hola mundo");
    expect(result?.provider).toBe("cohere");
  });

  test("returns null when the validator refuses every provider", async () => {
    validateTranscriptLanguage.mockReturnValue(false);
    const wrong = () =>
      jsonResponse({ choices: [{ message: { content: TRANSLATION } }] });
    server.use(
      http.post(PROVIDER_URLS.groqChat, wrong),
      http.post(PROVIDER_URLS.openrouterChat, wrong),
      http.post(PROVIDER_URLS.cohereChat, wrong),
      http.post(PROVIDER_URLS.mistralChat, wrong),
    );

    expect(await runTranslate(job())).toBeNull();
  });

  test("does not ask for a romanization when the caller does not want one", async () => {
    // Synthesis speaks the target script, so a transliteration would be paid
    // for and then stripped straight back off the result.
    validateTranscriptLanguage.mockReturnValue(true);
    let body = "";
    server.use(
      http.post(PROVIDER_URLS.groqChat, async ({ request }) => {
        body = await request.text();
        return jsonResponse({
          choices: [{ message: { content: "Hola mundo" } }],
        });
      }),
    );

    const result = await runTranslate(job({ wantTransliteration: false }));

    expect(result?.translation).toBe("Hola mundo");
    expect(body).not.toContain(ROMANIZATION_MARKER);
  });

  test("asks for a romanization when the caller wants one", async () => {
    validateTranscriptLanguage.mockReturnValue(true);
    let body = "";
    server.use(
      http.post(PROVIDER_URLS.groqChat, async ({ request }) => {
        body = await request.text();
        return jsonResponse({
          choices: [{ message: { content: "Hola mundo" } }],
        });
      }),
    );

    await runTranslate(job({ wantTransliteration: true }));

    expect(body).toContain(ROMANIZATION_MARKER);
  });
});
