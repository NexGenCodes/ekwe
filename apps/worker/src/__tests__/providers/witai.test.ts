import { describe, test, expect } from "vitest";
import * as witai from "@/providers/witai";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

const dictation = () =>
  http.post(PROVIDER_URLS.witaiDictation, () =>
    jsonResponse({ text: "Hello world", is_final: true }),
  );

function makeOggBlob(codecMarker: string): Blob {
  const bytes = new Uint8Array(64);
  const oggS = "OggS";
  for (let i = 0; i < oggS.length; i++) bytes[i] = oggS.charCodeAt(i);
  for (let i = 0; i < codecMarker.length; i++)
    bytes[28 + i] = codecMarker.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "audio/ogg" });
}

describe("Wit.ai provider", () => {
  test("returns result on success", async () => {
    server.use(dictation());

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
  });

  test("returns null when no key for language", async () => {
    const env = mockEnv({});
    const result = await witai.stt(makeAudioBlob(), "yo", env, mockSignal());
    expect(result).toBeNull();
  });

  test("skips Ogg/Opus without spending a request", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "should not be reached" });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(
      makeOggBlob("OpusHead"),
      "en",
      env,
      mockSignal(),
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("still calls the API for Ogg/Vorbis", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "vorbis result", is_final: true });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(
      makeOggBlob("\x01vorbis"),
      "en",
      env,
      mockSignal(),
    );

    expect(result!.text).toBe("vorbis result");
    expect(calls).toHaveLength(1);
  });

  test("skips an Ogg container holding a codec Wit.ai cannot parse", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "should not be reached" });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(
      makeOggBlob("\x7fFLAC"),
      "en",
      env,
      mockSignal(),
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("requires the Vorbis identification packet, not just the name", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "should not be reached" });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(
      makeOggBlob("vorbis"),
      "en",
      env,
      mockSignal(),
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("uses pool binding when no individual key", async () => {
    server.use(dictation());

    const env = mockEnv({
      WIT_KEY_EN: "",
      WIT_POOL_01: {
        get: async () => JSON.stringify({ EN: "mock-wit-pool-en-key-10" }),
      },
    });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
  });

  test("uses pool binding for base language fallback", async () => {
    server.use(dictation());

    const env = mockEnv({
      WIT_POOL_01: {
        get: async () => JSON.stringify({ EN: "mock-wit-pool-en-key-10" }),
      },
    });
    const result = await witai.stt(makeAudioBlob(), "en-US", env, mockSignal());
    expect(result).not.toBeNull();
  });

  test("individual key wins over pool binding", async () => {
    server.use(dictation());

    const env = mockEnv({
      WIT_KEY_EN: "mock-wit-en-key-10",
      WIT_POOL_01: {
        get: async () => JSON.stringify({ EN: "mock-wit-pool-en-key-10" }),
      },
    });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result!.text).toBe("Hello world");
  });

  test("returns null for unsupported MIME type", async () => {
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    const result = await witai.stt(blob, "en", env, mockSignal());
    expect(result).toBeNull();
  });

  test("throws on hallucination transcripts so the circuit breaker sees it", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "Thanks for watching", is_final: true }),
      ),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    await expect(
      witai.stt(makeAudioBlob(), "en", env, mockSignal()),
    ).rejects.toThrow("Wit.ai transcript discarded as hallucination");
  });

  test("throws on an empty transcript so it is not reported as neutral", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "", is_final: true }),
      ),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    await expect(
      witai.stt(makeAudioBlob(), "en", env, mockSignal()),
    ).rejects.toThrow("Wit.ai returned an empty transcript");
  });

  test("throws on HTTP error so the circuit breaker can trip", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ error: "bad auth" }, 401),
      ),
    );
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    await expect(
      witai.stt(makeAudioBlob(), "en", env, mockSignal()),
    ).rejects.toThrow("Wit.ai returned HTTP 401");
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
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
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
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result!.text).toBe("Hello world");
  });
});
