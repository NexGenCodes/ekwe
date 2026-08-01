import { describe, test, expect } from "vitest";
import { http, type StrictRequest, type DefaultBodyType } from "msw";
import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
import { mockEnv, makeAudioBlob, jsonResponse } from "../setup";

const SCHEMA_VERSION = "1.0.0";
const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Record<string, unknown> | string | null;
}

interface Fixture {
  schemaVersion: string;
  provider: string;
  operation: "transcribe" | "translate";
  requests: RecordedRequest[];
}

const CONTRACT_HEADERS = [
  "authorization",
  "content-type",
  "x-gladia-key",
  "http-referer",
  "x-title",
];

function redact(value: string): string {
  if (value.startsWith("Token ")) return "Token <REDACTED>";
  if (value.startsWith("Bearer ")) return "Bearer <REDACTED>";
  return "<REDACTED>";
}

function parseMultipart(
  text: string,
): { fields: Record<string, string>; files: Record<string, string> } {
  const fields: Record<string, string> = {};
  const files: Record<string, string> = {};
  const re =
    /name="([^"]+)"(?:;\s*filename="([^"]*)")?[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|--$)/g;
  for (const match of text.matchAll(re)) {
    const name = match[1] as string;
    const filename = match[2];
    const value = (match[3] ?? "").replace(/\r\n$/, "");
    if (filename !== undefined && filename !== "") {
      files[name] = `<file:${filename}>`;
    } else {
      fields[name] = value;
    }
  }
  return { fields, files };
}

async function toRecorded(
  request: StrictRequest<DefaultBodyType>,
): Promise<RecordedRequest> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  for (const name of CONTRACT_HEADERS) {
    const value = request.headers.get(name);
    if (value === null) continue;
    let headerValue =
      name === "authorization" || name === "x-gladia-key"
        ? redact(value)
        : value;
    if (name === "content-type" && headerValue.includes("boundary=")) {
      headerValue = headerValue.replace(/boundary=[^;]+/, "boundary=<BOUNDARY>");
    }
    headers[name] = headerValue;
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  const raw = await request.clone().text();
  let body: Record<string, unknown> | string | null;
  if (contentType.includes("multipart/form-data")) {
    const { fields, files } = parseMultipart(raw);
    body = { fields, files };
  } else if (contentType.includes("application/json")) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = raw;
    }
  } else {
    body = raw.length > 0 ? "<binary>" : null;
  }

  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = key === "key" ? "<REDACTED>" : value;
  }

  return { method: request.method, path: url.pathname, query, headers, body };
}

interface Case {
  provider: string;
  operation: "transcribe" | "translate";
  handlers: Array<{
    method: "get" | "post";
    url: string;
    respond: () => Response;
  }>;
  run: (signal: AbortSignal) => Promise<unknown>;
}

const blob = makeAudioBlob();

function singleKeyEnv(clear: string[]): ReturnType<typeof mockEnv> {
  const overrides: Record<string, string> = {};
  for (const key of clear) overrides[key] = "";
  return mockEnv(overrides);
}

const CASES: Case[] = [
  {
    provider: "deepgram",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.deepgram,
        respond: () =>
          jsonResponse({
            results: { channels: [{ alternatives: [{ transcript: "hi" }] }] },
            metadata: { duration: 1 },
          }),
      },
    ],
    run: (signal) =>
      deepgram.transcribe(
        blob,
        "en",
        singleKeyEnv(["DEEPGRAM_KEY_2"]),
        signal,
      ),
  },
  {
    provider: "groq",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.groqTranscriptions,
        respond: () => jsonResponse({ text: "hi" }),
      },
    ],
    run: (signal) =>
      groq.transcribe(blob, "en", singleKeyEnv(["GROQ_KEY_2"]), signal),
  },
  {
    provider: "cohere",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.cohereTranscriptions,
        respond: () => jsonResponse({ text: "hi" }),
      },
    ],
    run: (signal) =>
      cohere.transcribe(
        blob,
        "en",
        singleKeyEnv(["COHERE_KEY_2", "COHERE_KEY_3"]),
        signal,
      ),
  },
  {
    provider: "witai",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.witaiDictation,
        respond: () => jsonResponse({ text: "hi" }),
      },
    ],
    run: (signal) => witai.transcribe(blob, "en", mockEnv(), signal),
  },
  {
    provider: "gladia",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.gladiaUpload,
        respond: () => jsonResponse({ audio_url: "https://mock.gladia/uploaded" }),
      },
      {
        method: "post",
        url: PROVIDER_URLS.gladiaTranscription,
        respond: () => jsonResponse({ result_url: "https://mock.gladia/result" }),
      },
      {
        method: "get",
        url: "https://mock.gladia/result",
        respond: () =>
          jsonResponse({
            status: "done",
            result: { transcription: { full_transcript: "hi" } },
          }),
      },
    ],
    run: (signal) =>
      gladia.transcribe(
        blob,
        "en",
        singleKeyEnv(["GLADIA_KEY_2", "GLADIA_KEY_3", "GLADIA_KEY_4", "GLADIA_KEY_5"]),
        signal,
      ),
  },
  {
    provider: "assemblyai",
    operation: "transcribe",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.assemblyaiUpload,
        respond: () =>
          jsonResponse({ upload_url: "https://mock.assemblyai/uploaded" }),
      },
      {
        method: "post",
        url: PROVIDER_URLS.assemblyaiTranscript,
        respond: () => jsonResponse({ id: "abc123" }),
      },
      {
        method: "get",
        url: "https://api.assemblyai.com/v2/transcript/:id",
        respond: () => jsonResponse({ status: "completed", text: "hi" }),
      },
    ],
    run: (signal) =>
      assemblyai.transcribe(
        blob,
        "en",
        singleKeyEnv(["ASSEMBLYAI_KEY_2"]),
        signal,
      ),
  },
  {
    provider: "groq",
    operation: "translate",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.groqChat,
        respond: () =>
          jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      },
    ],
    run: (signal) =>
      groq.translate(
        "Hello",
        "Spanish",
        "English",
        singleKeyEnv(["GROQ_KEY_2"]),
        signal,
      ),
  },
  {
    provider: "cohere",
    operation: "translate",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.cohereChat,
        respond: () =>
          jsonResponse({ message: { content: [{ text: "hola" }] } }),
      },
    ],
    run: (signal) =>
      cohere.translate(
        "Hello",
        "Spanish",
        "English",
        singleKeyEnv(["COHERE_KEY_2", "COHERE_KEY_3"]),
        signal,
      ),
  },
  {
    provider: "gemini",
    operation: "translate",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.geminiGenerate,
        respond: () =>
          jsonResponse({ candidates: [{ content: { parts: [{ text: "hola" }] } }] }),
      },
    ],
    run: (signal) =>
      gemini.translate(
        "Hello",
        "Spanish",
        "English",
        singleKeyEnv(["GEMINI_KEY_2", "GEMINI_KEY_3"]),
        signal,
      ),
  },
  {
    provider: "mistral",
    operation: "translate",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.mistralChat,
        respond: () =>
          jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      },
    ],
    run: (signal) =>
      mistral.translate(
        "Hello",
        "Spanish",
        "English",
        singleKeyEnv([
          "MISTRAL_KEY_2",
          "MISTRAL_KEY_3",
          "MISTRAL_KEY_4",
          "MISTRAL_KEY_5",
        ]),
        signal,
      ),
  },
  {
    provider: "openrouter",
    operation: "translate",
    handlers: [
      {
        method: "post",
        url: PROVIDER_URLS.openrouterChat,
        respond: () =>
          jsonResponse({ choices: [{ message: { content: "hola" } }] }),
      },
    ],
    run: (signal) =>
      openrouter.translate("Hello", "Spanish", "English", mockEnv(), signal),
  },
];

async function recordAll(): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  for (const item of CASES) {
    const requests: RecordedRequest[] = [];
    const handlers = item.handlers.map((handler) => {
      const resolver = async ({ request }: { request: StrictRequest<DefaultBodyType> }) => {
        requests.push(await toRecorded(request));
        return handler.respond();
      };
      return handler.method === "get"
        ? http.get(handler.url, resolver)
        : http.post(handler.url, resolver);
    });
    server.use(...handlers);
    await item.run(new AbortController().signal);
    fixtures.push({
      schemaVersion: SCHEMA_VERSION,
      provider: item.provider,
      operation: item.operation,
      requests,
    });
  }
  return fixtures;
}

function fixtureFilename(fixture: Fixture): string {
  return `${fixture.provider}-${fixture.operation}.fixture.json`;
}

function normalize(fixture: Fixture): string {
  return JSON.stringify({ ...fixture, recordedAt: undefined }, null, 2);
}

async function readCommitted(): Promise<Map<string, Fixture>> {
  const map = new Map<string, Fixture>();
  let entries: string[];
  try {
    entries = await readdir(FIXTURES_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return map;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".fixture.json")) continue;
    const raw = await readFile(`${FIXTURES_DIR}/${entry}`, "utf8");
    map.set(entry, JSON.parse(raw) as Fixture);
  }
  return map;
}

describe.skipIf(process.env.FIXTURES_RECORD !== "1")("fixture recording", () => {
  test("record fixtures to disk", async () => {
    const recorded = await recordAll();
    expect(recorded.length).toBeGreaterThan(0);

    const committed = await readCommitted();
    const stale = new Set(committed.keys());
    for (const fixture of recorded) {
      const filename = fixtureFilename(fixture);
      stale.delete(filename);
      const payload = {
        schemaVersion: fixture.schemaVersion,
        provider: fixture.provider,
        operation: fixture.operation,
        recordedAt: new Date().toISOString(),
        requests: fixture.requests,
      };
      await mkdir(FIXTURES_DIR, { recursive: true });
      await writeFile(
        `${FIXTURES_DIR}/${filename}`,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8",
      );
    }

    expect([...stale]).toEqual([]);
  }, 30000);
});

describe.skipIf(process.env.FIXTURES_CHECK !== "1")("fixture drift", () => {
  test("recorded requests do not drift from committed fixtures", async () => {
    const recorded = await recordAll();
    const committed = await readCommitted();

    expect(committed.size).toBeGreaterThan(0);

    for (const fixture of recorded) {
      const filename = fixtureFilename(fixture);
      const golden = committed.get(filename);
      expect(
        golden,
        `missing committed fixture ${filename} — run 'pnpm fixtures:record'`,
      ).toBeDefined();
      expect(normalize(fixture), filename).toBe(normalize(golden as Fixture));
    }

    const recordedNames = new Set(recorded.map(fixtureFilename));
    for (const filename of committed.keys()) {
      expect(
        recordedNames.has(filename),
        `committed fixture ${filename} is stale — run 'pnpm fixtures:record'`,
      ).toBe(true);
    }
  }, 30000);
});
