import { describe, test, expect } from "vitest";
import { http, type StrictRequest, type DefaultBodyType } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";
import * as deepgram from "../../src/providers/deepgram";
import * as groq from "../../src/providers/groq";
import * as cohere from "../../src/providers/cohere";
import * as witai from "../../src/providers/witai";
import * as gladia from "../../src/providers/gladia";
import * as assemblyai from "../../src/providers/assemblyai";
import * as gemini from "../../src/providers/gemini";
import * as mistral from "../../src/providers/mistral";
import * as openrouter from "../../src/providers/openrouter";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "../setup";

interface CapturedRequest {
  method: string;
  url: string;
  auth: string | null;
  headers: Record<string, string>;
  body: string;
}

async function toCaptured(
  request: StrictRequest<DefaultBodyType>,
): Promise<CapturedRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    method: request.method,
    url: request.url,
    auth: request.headers.get("Authorization"),
    headers,
    body: await request.clone().text(),
  };
}

const blob = makeAudioBlob();
const signal = mockSignal();

function capture(
  url: string,
  handler: () => Response,
): () => CapturedRequest {
  let captured: CapturedRequest | undefined;
  server.use(
    http.post(url, async ({ request }) => {
      captured = await toCaptured(request);
      return handler();
    }),
  );
  return () => {
    expect(captured).toBeDefined();
    return captured!;
  };
}

describe("provider request contracts", () => {
  describe("transcription", () => {
    test("deepgram: POST /v1/listen with Token auth and audio/wav body", async () => {
      const get = capture(
        PROVIDER_URLS.deepgram,
        () =>
          jsonResponse({
            results: { channels: [{ alternatives: [{ transcript: "hi" }] }] },
            metadata: { duration: 1 },
          }),
      );
      await deepgram.transcribe(
        blob,
        "en",
        mockEnv({ DEEPGRAM_KEY_2: "" }),
        signal,
      );
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/v1/listen");
      expect(new URL(req.url).searchParams.get("model")).toBe("nova-3");
      expect(new URL(req.url).searchParams.get("language")).toBe("en");
      expect(req.auth).toBe("Token mock-deepgram-1-abcde");
      expect(req.headers["content-type"]).toBe("audio/wav");
    });

    test("groq: multipart with whisper-large-v3 and Bearer auth", async () => {
      const get = capture(PROVIDER_URLS.groqTranscriptions, () => jsonResponse({ text: "hi" }));
      await groq.transcribe(
        blob,
        "en",
        mockEnv({ GROQ_KEY_2: "" }),
        signal,
      );
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/openai/v1/audio/transcriptions");
      expect(req.auth).toBe("Bearer mock-groq-key-1-abcde");
      expect(req.body).toContain('name="model"');
      expect(req.body).toContain("whisper-large-v3");
      expect(req.body).toContain('name="language"');
      expect(req.body).toContain("en");
      expect(req.body).toContain('name="temperature"');
      expect(req.body).toContain("0");
    });

    test("cohere: multipart with cohere-transcribe model and Bearer auth", async () => {
      const get = capture(PROVIDER_URLS.cohereTranscriptions, () => jsonResponse({ text: "hi" }));
      await cohere.transcribe(
        blob,
        "en",
        mockEnv({ COHERE_KEY_2: "", COHERE_KEY_3: "" }),
        signal,
      );
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/v2/audio/transcriptions");
      expect(req.auth).toBe("Bearer mock-cohere-key-1-abcde");
      expect(req.body).toContain('name="model"');
      expect(req.body).toContain("cohere-transcribe-03-2026");
      expect(req.body).toContain('name="language"');
      expect(req.body).toContain("en");
    });

    test("witai: POST /dictation with Bearer auth and audio/wav body", async () => {
      const get = capture(PROVIDER_URLS.witaiDictation, () => jsonResponse({ text: "hi" }));
      await witai.transcribe(blob, "en", mockEnv(), signal);
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/dictation");
      expect(req.auth).toBe("Bearer mock-wit-en-key-10");
      expect(req.headers["content-type"]).toBe("audio/wav");
    });

    test("gladia: upload with x-gladia-key header", async () => {
      const get = capture(PROVIDER_URLS.gladiaUpload, () => jsonResponse({ audio_url: "https://a.b/c" }));
      await gladia.transcribe(
        blob,
        "en",
        mockEnv({ GLADIA_KEY_2: "", GLADIA_KEY_3: "", GLADIA_KEY_4: "", GLADIA_KEY_5: "" }),
        signal,
      );
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/v2/upload");
      expect(req.headers["x-gladia-key"]).toBe("mock-gladia-key-1-abcde");
      expect(req.body).toContain('name="audio"');
    });

    test("assemblyai: upload with raw key auth and octet-stream body", async () => {
      const get = capture(
        PROVIDER_URLS.assemblyaiUpload,
        () => jsonResponse({ upload_url: "https://a.b/c" }),
      );
      await assemblyai.transcribe(
        blob,
        "en",
        mockEnv({ ASSEMBLYAI_KEY_2: "" }),
        signal,
      );
      const req = get();
      expect(req.method).toBe("POST");
      expect(new URL(req.url).pathname).toBe("/v2/upload");
      expect(req.auth).toBe("mock-assembly-1-abcde");
      expect(req.headers["content-type"]).toBe("application/octet-stream");
    });
  });

  describe("translation", () => {
    test("groq: JSON chat completion with llama-3.3-70b-versatile", async () => {
      const get = capture(
        PROVIDER_URLS.groqChat,
        () => jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      );
      await groq.translate("Hello", "es", "en", mockEnv({ GROQ_KEY_2: "" }), signal);
      const req = get();
      expect(new URL(req.url).pathname).toBe("/openai/v1/chat/completions");
      expect(req.auth).toBe("Bearer mock-groq-key-1-abcde");
      const body = JSON.parse(req.body) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature: number;
      };
      expect(body.model).toBe("llama-3.3-70b-versatile");
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
      expect(body.temperature).toBe(0);
    });

    test("cohere: JSON chat with command-r7b-12-2024", async () => {
      const get = capture(
        PROVIDER_URLS.cohereChat,
        () => jsonResponse({ message: { content: [{ text: "hola" }] } }),
      );
      await cohere.translate(
        "Hello",
        "es",
        "en",
        mockEnv({ COHERE_KEY_2: "", COHERE_KEY_3: "" }),
        signal,
      );
      const req = get();
      expect(new URL(req.url).pathname).toBe("/v2/chat");
      expect(req.auth).toBe("Bearer mock-cohere-key-1-abcde");
      const body = JSON.parse(req.body) as {
        model: string;
        messages: Array<{ role: string }>;
      };
      expect(body.model).toBe("command-r7b-12-2024");
      expect(body.messages[0].role).toBe("system");
    });

    test("gemini: generateContent with API key in the x-goog-api-key header", async () => {
      const get = capture(
        PROVIDER_URLS.geminiGenerate,
        () =>
          jsonResponse({ candidates: [{ content: { parts: [{ text: "hola" }] } }] }),
      );
      await gemini.translate(
        "Hello",
        "es",
        "en",
        mockEnv({ GEMINI_KEY_2: "", GEMINI_KEY_3: "" }),
        signal,
      );
      const req = get();
      const url = new URL(req.url);
      expect(url.pathname.endsWith(":generateContent")).toBe(true);
      expect(url.pathname).toContain("gemini-3.5-flash");
      // The key must never ride in the URL — only the auth header, so it can't
      // leak into access logs, referrers, or proxy telemetry.
      expect(url.searchParams.get("key")).toBeNull();
      expect(req.headers["x-goog-api-key"]).toBe("mock-gemini-key-1-abcde");
      const body = JSON.parse(req.body) as {
        systemInstruction: { parts: Array<{ text: string }> };
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      };
      expect(body.systemInstruction.parts[0].text.length).toBeGreaterThan(10);
      expect(body.contents[0]).toEqual({
        role: "user",
        parts: [{ text: "Hello" }],
      });
    });

    test("mistral: JSON chat with mistral-small-2603", async () => {
      const get = capture(
        PROVIDER_URLS.mistralChat,
        () => jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      );
      await mistral.translate(
        "Hello",
        "es",
        "en",
        mockEnv({
          MISTRAL_KEY_2: "",
          MISTRAL_KEY_3: "",
          MISTRAL_KEY_4: "",
          MISTRAL_KEY_5: "",
        }),
        signal,
      );
      const req = get();
      expect(new URL(req.url).pathname).toBe("/v1/chat/completions");
      expect(req.auth).toBe("Bearer mock-mistral-key-1-abcde");
      const body = JSON.parse(req.body) as { model: string };
      expect(body.model).toBe("mistral-small-2603");
    });

    test("openrouter: JSON chat with branded referer headers", async () => {
      const get = capture(
        PROVIDER_URLS.openrouterChat,
        () => jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      );
      await openrouter.translate(
        "Hello",
        "es",
        "en",
        mockEnv(),
        signal,
      );
      const req = get();
      expect(new URL(req.url).pathname).toBe("/api/v1/chat/completions");
      expect(req.auth).toBe("Bearer mock-openrouter-key");
      expect(req.headers["http-referer"]).toBe("https://ekwe.app");
      expect(req.headers["x-title"]).toBe("Ekwe");
      const body = JSON.parse(req.body) as { model: string };
      expect(body.model).toBe("openrouter/free");
    });
  });
});
