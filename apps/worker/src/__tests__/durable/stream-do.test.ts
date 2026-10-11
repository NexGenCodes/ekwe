import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { StreamDurableObject } from "@/durable/stream-do";
import { ws } from "msw";
import { network } from "@/__tests__/msw/network";
import { jsonBody } from "@/__tests__/setup";
import { PREMIUM_LIMITS } from "@ekwe/shared";

interface CloseInfo {
  code: number;
  reason: string;
}

interface OpenedSession {
  stub: DurableObjectStub<StreamDurableObject>;
  ws: WebSocket;
  messages: string[];
  closes: CloseInfo[];
}

function getStub(name: string): DurableObjectStub<StreamDurableObject> {
  return env.STREAM_DO.getByName(name);
}

async function openSession(name: string, query = ""): Promise<OpenedSession> {
  const stub = getStub(name);
  const res = await stub.fetch(
    new Request(`http://example.com/transcribe/stream${query}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const messages: string[] = [];
  const closes: CloseInfo[] = [];
  ws.accept();
  ws.addEventListener("message", (event) => {
    messages.push(event.data as string);
  });
  ws.addEventListener("close", (event) => {
    closes.push({ code: event.code, reason: event.reason ?? "" });
  });
  return { stub, ws, messages, closes };
}

function waitFor(
  messages: string[],
  predicate: (message: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const match = messages.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - started > timeoutMs) {
        return reject(
          new Error(
            `Timed out waiting for message. Got: ${JSON.stringify(messages)}`,
          ),
        );
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function waitForClose(
  closes: CloseInfo[],
  code: number,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (closes.some((c) => c.code === code)) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(
          new Error(
            `Timed out waiting for close code ${code}. Got: ${JSON.stringify(closes)}`,
          ),
        );
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe("StreamDurableObject", () => {
  it("rejects non-WebSocket requests with 426", async () => {
    const stub = getStub("no-upgrade");
    const res = await stub.fetch(
      new Request("http://example.com/transcribe/stream"),
    );
    expect(res.status).toBe(426);
  });

  it("acks a valid config message and closes with NO_PROVIDER_AVAILABLE", async () => {
    const { ws, messages, closes } = await openSession(
      "config-user",
      "?tier=PREMIUM&lang=en",
    );
    ws.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );

    const ack = await waitFor(messages, (m) => m.includes("config_ack"));
    expect(JSON.parse(ack).status).toBe("ready");

    const err = await waitFor(messages, (m) =>
      m.includes("NO_PROVIDER_AVAILABLE"),
    );
    expect(JSON.parse(err).error).toBe("NO_PROVIDER_AVAILABLE");

    await waitForClose(closes, 4004);
  });

  it("caps concurrent streams at the plan limit", async () => {
    const name = "cap-user";
    const cap = PREMIUM_LIMITS.maxConcurrentStreams;
    for (let i = 0; i < cap; i++) {
      await openSession(name, "?tier=PREMIUM");
    }

    const res = await getStub(name).fetch(
      new Request("http://example.com/transcribe/stream?tier=PREMIUM", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(res.status).toBe(429);
    const body = await jsonBody(res);
    expect(body.error).toBe("TOO_MANY_CONNECTIONS");
  });

  it("prods for a config message, then times out if none arrives", async () => {
    const { stub, messages, closes } = await openSession(
      "config-timeout",
      "?tier=PREMIUM&lang=en",
    );

    const ranFirst = await runDurableObjectAlarm(stub);
    expect(ranFirst).toBe(true);
    await waitFor(messages, (m) => m.includes("config_request"));

    const ranSecond = await runDurableObjectAlarm(stub);
    expect(ranSecond).toBe(true);
    await waitFor(messages, (m) => m.includes("CONFIG_TIMEOUT"));
    await waitForClose(closes, 1000);
  });

  it("rejects audio that exceeds the tier byte limit", async () => {
    // PREMIUM: streaming is Pro-only, so FREE can never hold a session to
    // push bytes through.
    const { ws, messages, closes } = await openSession(
      "too-big",
      "?tier=PREMIUM",
    );
    ws.send(new ArrayBuffer(PREMIUM_LIMITS.maxAudioBytes + 1));

    const err = await waitFor(messages, (m) => m.includes("FILE_TOO_LARGE"));
    expect(JSON.parse(err).error).toBe("FILE_TOO_LARGE");
    await waitForClose(closes, 1000);
  });

  it("rejects sessions that exceed the tier duration limit", async () => {
    const { stub, ws, closes } = await openSession(
      "duration-user",
      "?tier=PREMIUM",
    );

    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(StreamDurableObject);
      const [sock] = state.getWebSockets();
      expect(sock).toBeDefined();
      const attached = sock.deserializeAttachment() as { startTime: number };
      attached.startTime = Date.now() - 200_000;
      sock.serializeAttachment(attached);
    });

    ws.send(new ArrayBuffer(8));
    await waitForClose(closes, 4005);
  });

  it("persists session state in the per-connection attachment", async () => {
    const { stub } = await openSession("state-user", "?tier=PREMIUM&lang=fr");

    await runInDurableObject(stub, async (_instance, state) => {
      const [sock] = state.getWebSockets();
      expect(sock).toBeDefined();
      const attached = sock.deserializeAttachment() as {
        configReceived: boolean;
        configRequested: boolean;
        cumulativeBytes: number;
        lang: string;
        tier: string;
      };
      expect(attached.configReceived).toBe(false);
      expect(attached.configRequested).toBe(false);
      expect(attached.cumulativeBytes).toBe(0);
      expect(attached.lang).toBe("fr");
      expect(attached.tier).toBe("PREMIUM");
    });
  });
});

describe("StreamDurableObject — provider WebSocket boundary", () => {
  // Flux is dialled first, so the default mock is the v2 turn-detection socket.
  const DEEPGRAM_LINK = "wss://api.deepgram.com/v2/listen";
  const DEEPGRAM_NOVA_LINK = "wss://api.deepgram.com/v1/listen";
  const DEEPGRAM_KEY = "mock-deepgram-key-stream-abc";

  function withAssemblyAiKey(): void {
    (env as unknown as Record<string, string>).ASSEMBLYAI_KEY_1 =
      "mock-assemblyai-key-stream-abc";
  }

  function withDeepgramKey(): void {
    (env as unknown as Record<string, string>).DEEPGRAM_KEY_1 = DEEPGRAM_KEY;
  }

  /** Only `send` is needed to drive the mocked upstream socket. */
  interface UpstreamSocket {
    send(data: string): void;
  }

  function deepgramLink(
    reply: (count: number, client: UpstreamSocket) => void,
  ): {
    connected: () => boolean;
    /** Distinct outbound sockets accepted, not frames forwarded. */
    sockets: () => number;
  } {
    let connected = false;
    let socketCount = 0;
    let messageCount = 0;
    network.use(
      ws.link(DEEPGRAM_LINK).addEventListener("connection", ({ client }) => {
        connected = true;
        socketCount++;
        client.addEventListener("message", () => {
          messageCount++;
          reply(messageCount, client);
        });
      }),
    );
    return { connected: () => connected, sockets: () => socketCount };
  }

  async function waitForFlag(
    flag: () => boolean,
    timeoutMs = 2000,
  ): Promise<void> {
    const started = Date.now();
    while (!flag() && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(flag()).toBe(true);
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /** A completed Flux turn: the whole turn's text plus the languages in it. */
  function deepgramResult(transcript: string, isFinal: boolean): string {
    return JSON.stringify({
      type: "TurnInfo",
      event: isFinal ? "EndOfTurn" : "Update",
      transcript,
      languages: ["en"],
    });
  }

  function assemblyResult(transcript: string, isFinal: boolean): string {
    return JSON.stringify({
      type: "Turn",
      text: transcript,
      end_of_turn: isFinal,
      turn_is_formatted: true,
      language_code: "en",
    });
  }

  /** The older per-segment shape Nova-3 still uses. */
  function novaResult(transcript: string, isFinal: boolean): string {
    return JSON.stringify({
      type: "Results",
      channel: { alternatives: [{ transcript }] },
      is_final: isFinal,
    });
  }

  it("replaces the config-negotiation alarm with the idle timeout once config arrives", async () => {
    const mock = deepgramLink(() => {});
    withDeepgramKey();
    const {
      stub,
      ws: clientWs,
      messages,
      closes,
    } = await openSession("idle-alarm-config", "?tier=PREMIUM&lang=en");

    const alarmBefore = await runInDurableObject(stub, async (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(alarmBefore).toBeDefined();
    expect(alarmBefore! - Date.now()).toBeLessThan(10_000);

    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(mock.connected);

    const alarmAfter = await runInDurableObject(stub, async (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(alarmAfter).toBeDefined();
    expect(alarmAfter! - Date.now()).toBeGreaterThan(45_000);
    expect(alarmAfter! - Date.now()).toBeLessThan(70_000);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("connects to the first streaming provider and relays a final transcript", async () => {
    const mock = deepgramLink((count, client) => {
      if (count !== 1) return;
      client.send(deepgramResult("streaming transcript", true));
    });

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("dg-final", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));

    await waitForFlag(mock.connected);

    clientWs.send(new ArrayBuffer(8));
    const finalMsg = await waitFor(messages, (m) =>
      m.includes("streaming transcript"),
    );
    expect(JSON.parse(finalMsg)).toEqual({
      type: "final",
      text: "streaming transcript",
      provider: "deepgram",
      // Flux reports the languages in the turn, which is what pins the language.
      language: "en",
    });

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("relays interim results before the final transcript", async () => {
    const mock = deepgramLink((count, client) => {
      client.send(
        deepgramResult(
          count === 1 ? "interim result" : "final result",
          count === 2,
        ),
      );
    });

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("dg-interim", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(mock.connected);

    clientWs.send(new ArrayBuffer(8));
    const interimMsg = await waitFor(messages, (m) =>
      m.includes("interim result"),
    );
    expect(JSON.parse(interimMsg)).toEqual({
      type: "interim",
      text: "interim result",
      provider: "deepgram",
      language: "en",
    });

    clientWs.send(new ArrayBuffer(8));
    const finalMsg = await waitFor(messages, (m) => m.includes("final result"));
    expect(JSON.parse(finalMsg)).toEqual({
      type: "final",
      text: "final result",
      provider: "deepgram",
      language: "en",
    });

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("restarts the provider pipeline after DO hibernation", async () => {
    const mock = deepgramLink((_count, client) => {
      client.send(deepgramResult("post-hibernation", true));
    });

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("hibernation-restart", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(() => mock.sockets() === 1);

    await runInDurableObject(
      getStub("hibernation-restart"),
      async (instance) => {
        (
          instance as unknown as { connections: Map<unknown, unknown> }
        ).connections.clear();
      },
    );

    clientWs.send(new ArrayBuffer(8));
    await waitForFlag(() => mock.sockets() === 2);
    const msg = await waitFor(messages, (m) => m.includes("post-hibernation"));
    expect(JSON.parse(msg).provider).toBe("deepgram");

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("does not open a second provider socket per audio frame", async () => {
    const mock = deepgramLink((_count, client) => {
      client.send(deepgramResult("frame transcript", false));
    });

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("no-duplicate-conn", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(() => mock.sockets() === 1);

    clientWs.send(new ArrayBuffer(8));
    clientWs.send(new ArrayBuffer(8));
    clientWs.send(new ArrayBuffer(8));
    await waitFor(messages, (m) => m.includes("frame transcript"));

    await new Promise((r) => setTimeout(r, 100));
    expect(mock.sockets()).toBe(1);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("abandons a pending failover when the device never reports silence", async () => {
    // Flux answers the first frame, then dies. No `vad` message ever arrives, so
    // the swap can only happen once the deadline passes.
    let fluxSockets = 0;
    network.use(
      ws.link(DEEPGRAM_LINK).addEventListener("connection", ({ client }) => {
        fluxSockets++;
        client.addEventListener("message", () => {
          client.close();
        });
      }),
    );
    network.use(
      ws
        .link("wss://streaming.assemblyai.com/v3/ws")
        .addEventListener("connection", ({ client }) => {
          client.close();
        }),
    );
    network.use(
      ws
        .link(DEEPGRAM_NOVA_LINK)
        .addEventListener("connection", ({ client }) => {
          client.addEventListener("message", () => {
            client.send(novaResult("after failover", true));
          });
        }),
    );

    withDeepgramKey();
    withAssemblyAiKey();
    const {
      stub,
      ws: clientWs,
      messages,
      closes,
    } = await openSession("deadline-timeout", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(() => fluxSockets > 0);

    clientWs.send(new ArrayBuffer(8));
    await settle();

    // The failover is now parked on a silence boundary that will never come.
    const deadline = await runInDurableObject(stub, async (_i, state) => {
      const [sock] = state.getWebSockets();
      return (
        sock.deserializeAttachment() as { failoverDeadlineAt: number | null }
      ).failoverDeadlineAt;
    });
    expect(deadline).not.toBeNull();

    // Pull the deadline forward instead of waiting it out, then run the alarm
    // that was armed for it.
    await runInDurableObject(stub, async (_instance, state) => {
      const [sock] = state.getWebSockets();
      const attached = sock.deserializeAttachment() as {
        failoverDeadlineAt: number | null;
        lastIdleResetAt: number;
      };
      attached.failoverDeadlineAt = Date.now() - 1;
      attached.lastIdleResetAt = Date.now();
      sock.serializeAttachment(attached);
    });
    await runDurableObjectAlarm(stub);

    clientWs.send(new ArrayBuffer(8));
    const msg = await waitFor(messages, (m) => m.includes("after failover"));
    expect(JSON.parse(msg).provider).toBe("deepgram");
    expect(closes).toHaveLength(0);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("bills the stretch after a failover instead of only the first", async () => {
    // The first provider completes a turn, then dies on the next frame, so the
    // session has two billable stints rather than one.
    let fluxMessages = 0;
    network.use(
      ws.link(DEEPGRAM_LINK).addEventListener("connection", ({ client }) => {
        client.addEventListener("message", () => {
          fluxMessages++;
          if (fluxMessages === 1) {
            client.send(deepgramResult("first stint", true));
          } else {
            client.close();
          }
        });
      }),
    );
    network.use(
      ws
        .link("wss://streaming.assemblyai.com/v3/ws")
        .addEventListener("connection", ({ client }) => {
          client.addEventListener("message", () => {
            client.send(assemblyResult("second stint", true));
          });
        }),
    );

    withDeepgramKey();
    const {
      stub,
      ws: clientWs,
      messages,
      closes,
    } = await openSession("billing-failover", "?tier=PREMIUM&lang=en");

    const readBilling = async (): Promise<{
      billedMinutes: number;
      billedSince: number;
    }> =>
      runInDurableObject(stub, async (_i, state) => {
        const [sock] = state.getWebSockets();
        return sock.deserializeAttachment() as {
          billedMinutes: number;
          billedSince: number;
        };
      });

    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));

    clientWs.send(new ArrayBuffer(8));
    await waitFor(messages, (m) => m.includes("first stint"));
    // Sub-second in, so there is no whole minute to report yet.
    expect((await readBilling()).billedMinutes).toBe(0);

    // Rewind the unbilled stretch so the second stint contains a whole minute.
    await runInDurableObject(stub, async (_instance, state) => {
      const [sock] = state.getWebSockets();
      const attached = sock.deserializeAttachment() as { billedSince: number };
      attached.billedSince = Date.now() - 61_000;
      sock.serializeAttachment(attached);
    });

    clientWs.send(new ArrayBuffer(8));
    await waitFor(messages, (m) => m.includes("second stint"));

    // The second provider's minute is reported on top of the first, not instead.
    expect((await readBilling()).billedMinutes).toBeGreaterThanOrEqual(1);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("reschedules the idle alarm and keeps an active socket alive when its deadline is still ahead", async () => {
    const deepgram = deepgramLink(() => {});
    withDeepgramKey();
    const {
      stub,
      ws: clientWs,
      messages,
      closes,
    } = await openSession("idle-alarm-extend", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(deepgram.connected);

    const futureReset = Date.now() + 30_000;
    await runInDurableObject(stub, async (_instance, state) => {
      const [sock] = state.getWebSockets();
      const attached = sock.deserializeAttachment() as {
        lastIdleResetAt: number;
      };
      attached.lastIdleResetAt = futureReset;
      sock.serializeAttachment(attached);
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closes.some((c) => c.code === 4002)).toBe(false);

    const nextAlarm = await runInDurableObject(stub, async (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(nextAlarm).toBeGreaterThan(futureReset + 60_000 - 5_000);
    expect(nextAlarm).toBeLessThan(futureReset + 60_000 + 5_000);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("closes an idle socket once its per-socket deadline has passed", async () => {
    const deepgram = deepgramLink(() => {});
    withDeepgramKey();
    const {
      stub,
      ws: clientWs,
      messages,
      closes,
    } = await openSession("idle-alarm-close", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(deepgram.connected);

    await runInDurableObject(stub, async (_instance, state) => {
      const [sock] = state.getWebSockets();
      const attached = sock.deserializeAttachment() as {
        lastIdleResetAt: number;
      };
      attached.lastIdleResetAt = Date.now() - 70_000;
      sock.serializeAttachment(attached);
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await waitForClose(closes, 4002);
    await settle();
  });
  // Last in the file: MSW handlers persist for the life of the run, and this
  // one refuses every route, so nothing after it could connect.
  it("fails over to the next route for the language and keeps the client open", async () => {
    // Flux and u3-rt-pro are refused, so the session must land on Nova-3, which
    // is the next route covering English and uses the older Results shape.
    for (const link of [
      DEEPGRAM_LINK,
      "wss://streaming.assemblyai.com/v3/ws",
    ]) {
      network.use(
        ws.link(link).addEventListener("connection", ({ client }) => {
          client.close();
        }),
      );
    }
    let novaSockets = 0;
    network.use(
      ws
        .link(DEEPGRAM_NOVA_LINK)
        .addEventListener("connection", ({ client }) => {
          novaSockets++;
          client.addEventListener("message", () => {
            client.send(novaResult("nova fallback", true));
          });
        }),
    );

    withDeepgramKey();
    withAssemblyAiKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("dg-failover", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitFor(messages, (m) => m.includes("deepgram-nova-3"));
    expect(novaSockets).toBe(1);

    clientWs.send(new ArrayBuffer(8));
    const finalMsg = await waitFor(messages, (m) =>
      m.includes("nova fallback"),
    );
    expect(JSON.parse(finalMsg)).toEqual({
      type: "final",
      text: "nova fallback",
      provider: "deepgram",
    });
    expect(closes).toHaveLength(0);

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("moves on when the first provider's WebSocket fails to connect", async () => {
    network.use(
      ws.link(DEEPGRAM_LINK).addEventListener("connection", ({ client }) => {
        client.close();
      }),
    );
    // u3-rt-pro is next in the pipeline for English, so it must be refused too
    // for the session to exhaust its routes.
    for (const link of [
      "wss://streaming.assemblyai.com/v3/ws",
      DEEPGRAM_NOVA_LINK,
      "wss://api.gladia.io/v2/live",
      "https://api.wit.ai/dictation",
    ]) {
      network.use(
        ws.link(link).addEventListener("connection", ({ client }) => {
          client.close();
        }),
      );
    }

    withDeepgramKey();
    withAssemblyAiKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("dg-refused", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({
        type: "config",
        lang: "en",
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        frameSizeMs: 20,
      }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));

    const err = await waitFor(messages, (m) =>
      m.includes("NO_PROVIDER_AVAILABLE"),
    );
    expect(JSON.parse(err).error).toBe("NO_PROVIDER_AVAILABLE");
    await waitForClose(closes, 4004);
    await settle();
  });
});
