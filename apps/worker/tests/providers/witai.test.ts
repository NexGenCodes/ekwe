import { describe, test, expect } from "vitest";
import * as witai from "../../src/providers/witai";
import { mockEnv, makeAudioBlob, jsonResponse, mockSignal } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

const dictation = () =>
  http.post(PROVIDER_URLS.witaiDictation, () =>
    jsonResponse({ text: "Hello world", is_final: true }),
  );

describe("Wit.ai provider", () => {
  test("returns result on success", async () => {
    server.use(dictation());

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
  });

  test("returns null when no key for language", async () => {
    const env = mockEnv({});
    const result = await witai.transcribe(
      makeAudioBlob(),
      "yo",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null for unsupported MIME type", async () => {
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    const result = await witai.transcribe(blob, "en", env, mockSignal());
    expect(result).toBeNull();
  });

  test("discards hallucination transcripts", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "Thanks for watching", is_final: true }),
      ),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null when no transcript in stream response", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "", is_final: true }),
      ),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on HTTP error", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ error: "bad auth" }, 401),
      ),
    );
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("handles multi-chunk streaming response", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        const chunks = [
          JSON.stringify({ text: "Hello", is_final: false }),
          JSON.stringify({ text: "Hello world", is_final: true }),
        ].join("\n");
        return new Response(chunks, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result!.text).toBe("Hello world");
  });

  test("handles BOM prefix", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        return new Response(
          "\uFEFF" + JSON.stringify({ text: "Hello world", is_final: true }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result!.text).toBe("Hello world");
  });
});
