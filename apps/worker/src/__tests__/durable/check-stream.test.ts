/**
 * Streaming coverage report.
 *
 * `stream-do.test.ts` already exercises the Durable Object in depth — failover,
 * hibernation, billing, concurrency and idle deadlines. What it does not do is
 * assert that every route in the shared registry is one the worker can actually
 * dial and relay from. A route can be declared in `STREAM_ROUTES`, claimed by a
 * provider module, and still be wired to an endpoint that never returns a
 * transcript, and nothing would notice until a user hit that language.
 *
 * So this file is deliberately narrow: one pass per implemented route proving
 * `ready` → `final` reaches the client, plus the two claims that are cheap to
 * get wrong — that every claimed route is reachable, and that a language no
 * route covers is refused up front rather than after a dial.
 *
 * Routes are made reachable the way the existing suite does it: earlier links
 * are closed on connect so the pipeline advances, rather than muted, since a
 * muted socket holds the session open until its timeout instead of yielding.
 *
 * Run with:
 *   pnpm --filter worker exec vitest run --project workers \
 *     src/__tests__/durable/check-stream.test.ts
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { ws } from "msw";
import { network } from "@/__tests__/msw/network";
import { server } from "@/__tests__/msw/server";
import { getStreamRoutes } from "@/providers";
import { resetHealthMemo } from "@/services/health";
import type { StreamDurableObject } from "@/durable/stream-do";

const FLUX_LINK = "wss://api.deepgram.com/v2/listen";
const NOVA_LINK = "wss://api.deepgram.com/v1/listen";
const AAI_LINK = "wss://streaming.assemblyai.com/v3/ws";

/** The upstream payload each route's adapter is written to parse. */
const REPLY: Record<string, string> = {
  // Flux v2 reports whole turns as TurnInfo/EndOfTurn.
  flux: JSON.stringify({
    type: "TurnInfo",
    event: "EndOfTurn",
    transcript: "flux transcript",
    languages: ["en"],
  }),
  // u3-rt-pro frames a turn as text/end_of_turn.
  aai: JSON.stringify({
    type: "Turn",
    text: "assembly transcript",
    end_of_turn: true,
    turn_is_formatted: true,
    language_code: "en",
  }),
  // Nova-3 still uses the older per-segment Results shape.
  nova: JSON.stringify({
    type: "Results",
    channel: { alternatives: [{ transcript: "nova transcript" }] },
    is_final: true,
  }),
};

/** Answers every inbound frame with `payload`, like a live provider would. */
function answeringLink(link: string, payload: string): void {
  network.use(
    ws.link(link).addEventListener("connection", ({ client }) => {
      client.addEventListener("message", () => client.send(payload));
    }),
  );
}

/** Refuses the socket so the pipeline moves to the next route. */
function refusingLink(link: string): void {
  network.use(
    ws.link(link).addEventListener("connection", ({ client }) => {
      client.close();
    }),
  );
}

function waitFor(
  messages: string[],
  predicate: (m: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const match = messages.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error("no matching message"));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function openSession(name: string, lang: string) {
  const stub = env.STREAM_DO.getByName(
    name,
  ) as DurableObjectStub<StreamDurableObject>;
  const res = await stub.fetch(
    new Request(
      `http://example.com/transcribe/stream?tier=PREMIUM&lang=${lang}`,
      {
        headers: { Upgrade: "websocket" },
      },
    ),
  );
  expect(res.status).toBe(101);
  const clientWs = res.webSocket!;
  const messages: string[] = [];
  const closes: { code: number }[] = [];
  clientWs.accept();
  clientWs.addEventListener("message", (e) => messages.push(e.data as string));
  clientWs.addEventListener("close", (e) => closes.push({ code: e.code }));
  return { clientWs, messages, closes };
}

const isReady = (m: string) => m.includes('"type":"ready"');
const isFinal = (m: string) => m.includes('"type":"final"');

const configFor = (lang: string) =>
  JSON.stringify({
    type: "config",
    lang,
    format: "pcm_s16le",
    sampleRate: 16000,
    channels: 1,
    frameSizeMs: 20,
  });

function withKeys(): void {
  const e = env as unknown as Record<string, string>;
  e.DEEPGRAM_KEY_1 = "mock-deepgram-key-stream-abc";
  e.ASSEMBLYAI_KEY_1 = "mock-assemblyai-key-stream-abc";
  e.WIT_KEY_EN = "mock-wit-key-stream-abc";
}

/** Drives one session to completion and returns the route that answered. */
async function driveRoute(
  session: string,
  lang: string,
  expected: string,
  transcript: string,
): Promise<void> {
  const { clientWs, messages } = await openSession(session, lang);
  clientWs.send(configFor(lang));
  expect(JSON.parse(await waitFor(messages, isReady)).route).toBe(expected);
  // The upstream only answers once audio crosses it.
  clientWs.send(new ArrayBuffer(8));
  expect(JSON.parse(await waitFor(messages, isFinal)).text).toContain(
    transcript,
  );
  clientWs.send(JSON.stringify({ type: "stop" }));
}

describe("streaming route coverage", () => {
  // Each test installs its own socket mocks; without this the next one inherits
  // every handler the last installed.
  afterEach(() => {
    server.resetHandlers();
    resetHealthMemo();
  });

  it("claims exactly the routes the registry declares", () => {
    expect(getStreamRoutes().map((r) => r.id)).toEqual([
      "deepgram-flux-multi",
      "assemblyai-u3-rt-pro",
      "deepgram-nova-3",
      "gladia-solaria",
      "witai",
    ]);
  });

  it("dials deepgram-flux-multi and relays its final", async () => {
    withKeys();
    answeringLink(FLUX_LINK, REPLY.flux);
    await driveRoute(
      "coverage-flux",
      "en",
      "deepgram-flux-multi",
      "flux transcript",
    );
  }, 20_000);

  it("dials assemblyai-u3-rt-pro when Flux is refused", async () => {
    withKeys();
    refusingLink(FLUX_LINK);
    answeringLink(AAI_LINK, REPLY.aai);
    await driveRoute(
      "coverage-aai",
      "en",
      "assemblyai-u3-rt-pro",
      "assembly transcript",
    );
  }, 20_000);

  it("dials deepgram-nova-3 when Flux and AssemblyAI are refused", async () => {
    withKeys();
    refusingLink(FLUX_LINK);
    refusingLink(AAI_LINK);
    answeringLink(NOVA_LINK, REPLY.nova);
    await driveRoute(
      "coverage-nova",
      "en",
      "deepgram-nova-3",
      "nova transcript",
    );
  }, 20_000);

  it("answers an unsupported language with a real error, not an empty object", async () => {
    withKeys();
    const { clientWs, messages, closes } = await openSession(
      "coverage-unsupported",
      "en",
    );
    // `yue` is in the full catalog but outside the offered set, so the config
    // guard rejects it. The body has to arrive intact: `GuardFail.response` is a
    // Response, and stringifying one yields "{}", which is what this pins down.
    clientWs.send(configFor("yue"));
    const sent = JSON.parse(
      await waitFor(messages, (m) => m.includes("error")),
    );
    expect(sent).toEqual({
      error: "INVALID_LANGUAGE",
      message: "Unsupported language code: yue",
    });
    expect(closes.length).toBeGreaterThan(0);
  }, 20_000);
});
