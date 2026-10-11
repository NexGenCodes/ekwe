import { describe, test, expect } from "vitest";
import * as cohere from "@/providers/cohere";
import { mockEnv, jsonResponse, mockSignal } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { ProviderHttpError } from "@/core/provider-errors";

describe("Cohere provider", () => {
  test("transcribe returns text on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () =>
        jsonResponse({ text: "hello world" }),
      ),
    );

    const blob = new Blob(["fake audio"], { type: "audio/wav" });
    const result = await cohere.stt(blob, "en", mockEnv(), mockSignal());
    expect(result).not.toBeNull();
    expect(result!.text).toBe("hello world");
    expect(result!.provider).toBe("cohere");
  });

  test("transcribe throws on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () =>
        jsonResponse({ error: "fail" }, 500),
      ),
    );

    const blob = new Blob(["fake audio"], { type: "audio/wav" });
    await expect(
      cohere.stt(blob, "en", mockEnv(), mockSignal()),
    ).rejects.toThrow(ProviderHttpError);
  });

  test("transcribe returns null on missing text", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () => jsonResponse({})),
    );

    const blob = new Blob(["fake audio"], { type: "audio/wav" });
    const result = await cohere.stt(blob, "en", mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test("transcribe does not skip supported languages", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () =>
        jsonResponse({ text: "hola mundo" }),
      ),
    );
    const result = await cohere.stt(
      new Blob(["fake"], { type: "audio/wav" }),
      "es",
      mockEnv(),
      mockSignal(),
    );
    expect(result!.text).toBe("hola mundo");
  });

  test("returns translation on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ message: { content: [{ text: "Bonjour le monde" }] } }),
      ),
    );

    const result = await cohere.ttt(
      "Hello world",
      {
        targetLang: "fr",
        sourceLang: "en",
        transliteration: false,
      },
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe("Bonjour le monde");
    expect(result!.provider).toBe("cohere");
  });

  test("translate throws on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ error: "unauthorized" }, 401),
      ),
    );
    await expect(
      cohere.ttt(
        "Hello",
        { targetLang: "fr", sourceLang: "en", transliteration: false },
        mockEnv(),
        mockSignal(),
      ),
    ).rejects.toThrow(ProviderHttpError);
  });

  test("returns null on empty message content", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ message: { content: [] } }),
      ),
    );
    const result = await cohere.ttt(
      "Hello",
      { targetLang: "fr", sourceLang: "en", transliteration: false },
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on missing message", async () => {
    server.use(http.post(PROVIDER_URLS.cohereChat, () => jsonResponse({})));
    const result = await cohere.ttt(
      "Hello",
      { targetLang: "fr", sourceLang: "en", transliteration: false },
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
