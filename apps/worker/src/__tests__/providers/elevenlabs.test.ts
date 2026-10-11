import { describe, test, expect } from "vitest";
import * as elevenlabs from "@/providers/elevenlabs";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

describe("ElevenLabs provider", () => {
  describe("transcribe", () => {
    test("returns result on success", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, () =>
          jsonResponse({
            text: "Hello world",
            language_code: "en",
          }),
        ),
      );

      const result = await elevenlabs.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(result).not.toBeNull();
      expect(result!.text).toBe("Hello world");
      expect(result!.provider).toBe("elevenlabs");
      expect(result!.language).toBe("en");
    });

    test("sends the Scribe 639-3 spelling for the requested language", async () => {
      let seen: FormData | null = null;
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, async ({ request }) => {
          seen = (await request.formData()) as unknown as FormData;
          return jsonResponse({
            text: "Bonjour le monde",
            language_code: "fr",
          });
        }),
      );

      await elevenlabs.stt(makeAudioBlob(), "yo", mockEnv(), mockSignal());

      expect((seen as unknown as FormData).get("model_id")).toBe("scribe_v2");
      expect((seen as unknown as FormData).get("language_code")).toBe("yor");
    });

    test("omits language_code in auto mode and reports what Scribe detects", async () => {
      let seen: FormData | null = null;
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, async ({ request }) => {
          seen = (await request.formData()) as unknown as FormData;
          return jsonResponse({
            text: "Bonjour le monde",
            language_code: "fr",
          });
        }),
      );

      const result = await elevenlabs.stt(
        makeAudioBlob(),
        "auto",
        mockEnv(),
        mockSignal(),
      );

      expect((seen as unknown as FormData).get("language_code")).toBeNull();
      expect(result?.language).toBe("fr");
    });

    test("reports a detected language outside the catalog as unresolved", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, () =>
          jsonResponse({
            text: "a greeting nobody catalogued",
            language_code: "fij",
          }),
        ),
      );

      const result = await elevenlabs.stt(
        makeAudioBlob(),
        "auto",
        mockEnv(),
        mockSignal(),
      );

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("language");
    });

    test("throws on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, () =>
          jsonResponse({ detail: "unauthorized" }, 401),
        ),
      );

      await expect(
        elevenlabs.stt(makeAudioBlob(), "en", mockEnv(), mockSignal()),
      ).rejects.toThrow();
    });

    test("returns null on a hallucinated transcript", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsStt, () =>
          jsonResponse({ text: "Thanks for watching!", language_code: "en" }),
        ),
      );

      const result = await elevenlabs.stt(
        makeAudioBlob(),
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(result).toBeNull();
    });
  });

  describe("speak", () => {
    const mp3 = new Uint8Array([
      0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
    ]);

    test("returns audio and the mp3 mime", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsTts, () => new Response(mp3)),
      );

      const attempt = await elevenlabs.tts(
        "Hello world",
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(attempt.status).toBeNull();
      expect(attempt.result?.mime).toBe("audio/mpeg");
      expect(attempt.result?.provider).toBe("elevenlabs");
      expect(attempt.result?.audio.byteLength).toBe(mp3.byteLength);
    });

    test("posts the Flash v2.5 model to the requested voice", async () => {
      let seen: { body: Record<string, unknown>; url: string } | null = null;
      server.use(
        http.post(PROVIDER_URLS.elevenlabsTts, async ({ request }) => {
          seen = {
            body: (await request.json()) as Record<string, unknown>,
            url: request.url,
          };
          return new Response(mp3);
        }),
      );

      await elevenlabs.tts(
        "Bonjour",
        "fr",
        mockEnv(),
        mockSignal(),
        "voice-123",
      );

      expect(seen!.body.model_id).toBe("eleven_flash_v2_5");
      expect(seen!.body.text).toBe("Bonjour");
      expect(seen!.url).toContain("/text-to-speech/voice-123");
    });

    test("refuses text over the per-request character limit", async () => {
      // Asking the provider anyway would return a clip that stops mid-sentence
      // while reporting success, so the cap is enforced before the request.
      const attempt = await elevenlabs.tts(
        "a".repeat(40_001),
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(attempt.result).toBeNull();
      expect(attempt.status).toBe(413);
    });

    test("returns a null result on HTTP error", async () => {
      server.use(
        http.post(PROVIDER_URLS.elevenlabsTts, () =>
          jsonResponse({ detail: "quota exceeded" }, 401),
        ),
      );

      const attempt = await elevenlabs.tts(
        "Hello",
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(attempt.result).toBeNull();
    });

    test("returns a null result for empty text", async () => {
      const attempt = await elevenlabs.tts(
        "   ",
        "en",
        mockEnv(),
        mockSignal(),
      );

      expect(attempt).toEqual({ result: null, status: null });
    });
  });

  describe("voices", () => {
    test("returns the curated list for the language and gender", () => {
      expect(elevenlabs.voices("female", "en")[0]).toBe("EXAVITQu4vr4xnSDxMaL");
      expect(elevenlabs.voices("male", "en")[0]).toBe("TxGEqnHWrfWFTfGW9XjX");
    });

    test("falls back to the default list for an uncatalogued language", () => {
      expect(elevenlabs.voices("female", "yo")).toEqual(
        elevenlabs.voices("female", "xx"),
      );
    });

    test("defaults to the female list when gender is unset", () => {
      expect(elevenlabs.voices(undefined, "en")).toEqual(
        elevenlabs.voices("female", "en"),
      );
    });
  });
});
