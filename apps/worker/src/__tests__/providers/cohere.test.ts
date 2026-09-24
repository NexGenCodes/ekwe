import { describe, test, expect } from "vitest";
import * as cohere from "@/providers/cohere";
import { mockEnv, jsonResponse, mockSignal } from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

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

  test("transcribe returns null for unsupported language", async () => {
    const blob = new Blob(["fake audio"], { type: "audio/wav" });
    const result = await cohere.stt(blob, "ig", mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test("transcribe returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereTranscriptions, () =>
        jsonResponse({ error: "fail" }, 500),
      ),
    );

    const blob = new Blob(["fake audio"], { type: "audio/wav" });
    const result = await cohere.stt(blob, "en", mockEnv(), mockSignal());
    expect(result).toBeNull();
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
    const result = await cohere.stt(
      new Blob(["fake"], { type: "audio/wav" }),
      "es",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns translation on success", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ message: { content: [{ text: "Bonjour le monde" }] } }),
      ),
    );

    const result = await cohere.translate(
      "Hello world",
      "French",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe("Bonjour le monde");
    expect(result!.provider).toBe("cohere");
  });

  test("returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ error: "unauthorized" }, 401),
      ),
    );
    const result = await cohere.translate(
      "Hello",
      "French",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on empty message content", async () => {
    server.use(
      http.post(PROVIDER_URLS.cohereChat, () =>
        jsonResponse({ message: { content: [] } }),
      ),
    );
    const result = await cohere.translate(
      "Hello",
      "French",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on missing message", async () => {
    server.use(http.post(PROVIDER_URLS.cohereChat, () => jsonResponse({})));
    const result = await cohere.translate(
      "Hello",
      "French",
      "English",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
