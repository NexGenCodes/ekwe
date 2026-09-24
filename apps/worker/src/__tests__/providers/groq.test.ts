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
          jsonResponse({ text: "Hello world", duration: 3.0, language: "en" }),
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

      const result = await groq.translate(
        "Hello world",
        "Spanish",
        "English",
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
      const result = await groq.translate(
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
        http.post(PROVIDER_URLS.groqChat, () => jsonResponse({ choices: [] })),
      );
      const result = await groq.translate(
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
