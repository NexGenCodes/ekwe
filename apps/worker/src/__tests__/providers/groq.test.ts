import { describe, test, expect } from "vitest";
import * as groq from "@/providers/groq";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("Groq provider", () => {
  describe("transcribe", () => {
    test("returns result on success", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, () =>
          jsonResponse({
            text: "Hello world",
            duration: 3.0,
            language: "English",
          }),
        ),
      );

      const blob = makeAudioBlob();
      const result = await groq.stt(blob, "en", mockEnv(), mockSignal());
      expect(result).not.toBeNull();
      expect(result!.text).toBe("Hello world");
      expect(result!.provider).toBe("groq");
      expect(result!.duration).toBe(3.0);
      expect(result!.language).toBe("en");
    });

    test("requests verbose_json in auto mode to get the detected language", async () => {
      // Regression guard: Groq's plain `json` format returns only `text`; the
      // language and duration fields arrive exclusively with `verbose_json`.
      // The auto path has nothing to report without it.
      let seen: FormData | null = null;
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, async ({ request }) => {
          seen = (await request.formData()) as unknown as FormData;
          return jsonResponse({
            text: "Bonjour le monde",
            // Whisper-family providers answer with the language spelled out,
            // so the name is what actually arrives on the wire.
            language: "French",
            duration: 2.5,
          });
        }),
      );

      const result = await groq.stt(
        makeAudioBlob(),
        "auto",
        mockEnv(),
        mockSignal(),
      );

      expect((seen as unknown as FormData).get("response_format")).toBe(
        "verbose_json",
      );
      expect((seen as unknown as FormData).get("language")).toBeNull();
      // Folded back to our canonical code, which is what every other provider
      // returns and what validateTranscriptLanguage compares against franc.
      expect(result?.language).toBe("fr");
      expect(result?.duration).toBe(2.5);
    });

    test("reports a detected language outside the catalog as unresolved", async () => {
      // Handing back the raw name would read as a language we support and then
      // fail every comparison downstream. Omitting it lets the worker's own
      // detector fill the gap instead.
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, () =>
          jsonResponse({
            text: "a greeting nobody catalogued",
            language: "Fijian",
            duration: 1.0,
          }),
        ),
      );

      const result = await groq.stt(
        makeAudioBlob(),
        "auto",
        mockEnv(),
        mockSignal(),
      );

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("language");
    });

    test("requests plain json and the language when it is known", async () => {
      let seen: FormData | null = null;
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, async ({ request }) => {
          seen = (await request.formData()) as unknown as FormData;
          return jsonResponse({ text: "Bonjour le monde" });
        }),
      );

      const result = await groq.stt(
        makeAudioBlob(),
        "fr",
        mockEnv(),
        mockSignal(),
      );

      expect((seen as unknown as FormData).get("response_format")).toBe("json");
      expect((seen as unknown as FormData).get("language")).toBe("fr");
      // Absent metadata is omitted rather than sent as an explicit undefined.
      expect(result).not.toHaveProperty("language");
      expect(result).not.toHaveProperty("duration");
    });

    test("returns null on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, () =>
          jsonResponse({ error: "unauthorized" }, 401),
        ),
      );
      const result = await groq.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on hallucination", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, () =>
          jsonResponse({ text: "Thanks for watching", duration: 1.0 }),
        ),
      );
      const result = await groq.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on empty response", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqTranscriptions, () => jsonResponse({})),
      );
      const result = await groq.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });

  describe("translate", () => {
    test("returns translation on success", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ choices: [{ message: { content: "Hola mundo" } }] }),
        ),
      );

      const result = await groq.ttt(
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
      expect(result!.provider).toBe("groq");
    });

    test("returns null on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqChat, () =>
          jsonResponse({ error: "unauthorized" }, 401),
        ),
      );
      const result = await groq.ttt(
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

    test("returns null on empty choices", async () => {
      server.use(
        http.post(PROVIDER_URLS.groqChat, () => jsonResponse({ choices: [] })),
      );
      const result = await groq.ttt(
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
