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
import {
  ProviderHttpError,
  ProviderUnusableError,
} from "@/core/provider-errors";

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

  test("throws when no key for language", async () => {
    const env = mockEnv({});
    await expect(
      witai.stt(makeAudioBlob(), "yo", env, mockSignal()),
    ).rejects.toThrow(ProviderUnusableError);
  });

  test("rejects Ogg/Opus without spending a request", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "should not be reached" });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });

    await expect(
      witai.stt(makeOggBlob("OpusHead"), "en", env, mockSignal()),
    ).rejects.toThrow(ProviderUnusableError);
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

  test("rejects an Ogg container holding a codec Wit.ai cannot parse", async () => {
    const calls: string[] = [];
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, ({ request }) => {
        calls.push(request.url);
        return jsonResponse({ text: "should not be reached" });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });

    await expect(
      witai.stt(makeOggBlob("\x7fFLAC"), "en", env, mockSignal()),
    ).rejects.toThrow(ProviderUnusableError);
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

    // The bare word "vorbis" is not the identification packet. Wit needs the
    // leading \x01 signature, so this must not reach the API.
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });

    await expect(
      witai.stt(makeOggBlob("vorbis"), "en", env, mockSignal()),
    ).rejects.toThrow(ProviderUnusableError);
    expect(calls).toHaveLength(0);
  });

  test("uses the base-language key when the exact dialect key is absent", async () => {
    server.use(dictation());

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en-US", env, mockSignal());
    expect(result).not.toBeNull();
  });

  test("uses the exact language key for dictation", async () => {
    server.use(dictation());

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result!.text).toBe("Hello world");
  });

  test("throws for an unsupported MIME type", async () => {
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    await expect(witai.stt(blob, "en", env, mockSignal())).rejects.toThrow(
      ProviderUnusableError,
    );
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
    ).rejects.toThrow(ProviderUnusableError);
  });

  test("returns null on an empty transcript, which is a genuine no-result", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () =>
        jsonResponse({ text: "", is_final: true }),
      ),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result).toBeNull();
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
    ).rejects.toThrow(ProviderHttpError);
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

  test("concatenates time-distinct finals, keeping a re-run tail", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        // Mirrors a live dictation stream: a full FINAL_TRANSCRIPTION followed
        // by a second FINAL for a real tail segment (independent time span).
        const chunks = [
          JSON.stringify({
            text: "Buenas tardes Como esta. Este no tenia celular?",
            type: "FINAL_TRANSCRIPTION",
            is_final: true,
            speech: { tokens: [{ start: 0, end: 7000 }] },
          }),
          JSON.stringify({
            text: "Como esta",
            type: "FINAL_TRANSCRIPTION",
            is_final: true,
            speech: { tokens: [{ start: 8000, end: 9300 }] },
          }),
        ].join("\n");
        return new Response(chunks, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result!.text).toBe(
      "Buenas tardes Como esta. Este no tenia celular? Como esta",
    );
  });

  test("replaces a final that re-finalizes the same time span", async () => {
    server.use(
      http.post(PROVIDER_URLS.witaiDictation, () => {
        // The same span re-emitted is a refinement (Wit re-commits a sentence
        // while still streaming), not a second utterance.
        const chunks = [
          JSON.stringify({
            text: "hola que tal",
            is_final: true,
            speech: { tokens: [{ start: 0, end: 2000 }] },
          }),
          JSON.stringify({
            text: "hola que tal amigos",
            is_final: true,
            speech: { tokens: [{ start: 0, end: 2000 }] },
          }),
        ].join("\n");
        return new Response(chunks, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.stt(makeAudioBlob(), "en", env, mockSignal());
    expect(result!.text).toBe("hola que tal amigos");
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
