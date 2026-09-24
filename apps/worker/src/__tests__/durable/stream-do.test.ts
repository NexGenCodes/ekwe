import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { StreamDurableObject } from "@/durable/stream-do";
import { ws } from "msw";
import { network } from "@/__tests__/msw/network";

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
    ws.send(JSON.stringify({ type: "config", codec: "opus", lang: "en" }));

    const ack = await waitFor(messages, (m) => m.includes("config_ack"));
    expect(JSON.parse(ack).status).toBe("ready");

    const err = await waitFor(messages, (m) =>
      m.includes("NO_PROVIDER_AVAILABLE"),
    );
    expect(JSON.parse(err).error).toBe("NO_PROVIDER_AVAILABLE");

    await waitForClose(closes, 4004);
  });

  it("caps concurrent streams per user at 3", async () => {
    const name = "cap-user";
    await openSession(name, "?tier=PREMIUM");
    await openSession(name, "?tier=PREMIUM");
    await openSession(name, "?tier=PREMIUM");

    const res = await getStub(name).fetch(
      new Request("http://example.com/transcribe/stream?tier=PREMIUM", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
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
    const { ws, messages, closes } = await openSession("too-big", "?tier=FREE");
    ws.send(new ArrayBuffer(6 * 1024 * 1024));

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
  const DEEPGRAM_LINK = "wss://api.deepgram.com/v1/listen";
  const DEEPGRAM_KEY = "mock-deepgram-key-stream-abc";

  function withDeepgramKey(): void {
    (env as any).DEEPGRAM_KEY_1 = DEEPGRAM_KEY;
  }

  function deepgramLink(reply: (count: number, client: any) => void): {
    connected: () => boolean;
  } {
    let connected = false;
    let messageCount = 0;
    const link = ws.link(DEEPGRAM_LINK);
    network.use(
      link.addEventListener("connection", ({ client }: any) => {
        connected = true;
        client.addEventListener("message", () => {
          messageCount++;
          reply(messageCount, client);
        });
      }),
    );
    return { connected: () => connected };
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

  function deepgramResult(transcript: string, isFinal: boolean): string {
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
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
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
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
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
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
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
    });

    clientWs.send(new ArrayBuffer(8));
    const finalMsg = await waitFor(messages, (m) => m.includes("final result"));
    expect(JSON.parse(finalMsg)).toEqual({
      type: "final",
      text: "final result",
      provider: "deepgram",
    });

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("moves on when the first provider's WebSocket fails to connect", async () => {
    const link = ws.link(DEEPGRAM_LINK);
    network.use(
      link.addEventListener("connection", ({ client }: any) => {
        client.close();
      }),
    );

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("dg-refused", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));

    const err = await waitFor(messages, (m) =>
      m.includes("NO_PROVIDER_AVAILABLE"),
    );
    expect(JSON.parse(err).error).toBe("NO_PROVIDER_AVAILABLE");
    await waitForClose(closes, 4004);
    await settle();
  });

  it("restarts the provider pipeline after DO hibernation", async () => {
    let connections = 0;
    const link = ws.link(DEEPGRAM_LINK);
    network.use(
      link.addEventListener("connection", ({ client }: any) => {
        connections++;
        client.addEventListener("message", () => {
          client.send(deepgramResult("post-hibernation", true));
        });
      }),
    );

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("hibernation-restart", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(() => connections === 1);

    await runInDurableObject(
      getStub("hibernation-restart"),
      async (instance) => {
        (
          instance as unknown as { connections: Map<unknown, unknown> }
        ).connections.clear();
      },
    );

    clientWs.send(new ArrayBuffer(8));
    await waitForFlag(() => connections === 2);
    const msg = await waitFor(messages, (m) => m.includes("post-hibernation"));
    expect(JSON.parse(msg).provider).toBe("deepgram");

    clientWs.send(JSON.stringify({ type: "stop" }));
    await waitForClose(closes, 1000);
    await settle();
  });

  it("does not open a second provider socket per audio frame", async () => {
    let connections = 0;
    const link = ws.link(DEEPGRAM_LINK);
    network.use(
      link.addEventListener("connection", ({ client }: any) => {
        connections++;
        client.addEventListener("message", () => {
          client.send(deepgramResult("frame transcript", false));
        });
      }),
    );

    withDeepgramKey();
    const {
      ws: clientWs,
      messages,
      closes,
    } = await openSession("no-duplicate-conn", "?tier=PREMIUM&lang=en");
    clientWs.send(
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
    );
    await waitFor(messages, (m) => m.includes("config_ack"));
    await waitForFlag(() => connections === 1);

    clientWs.send(new ArrayBuffer(8));
    clientWs.send(new ArrayBuffer(8));
    clientWs.send(new ArrayBuffer(8));
    await waitFor(messages, (m) => m.includes("frame transcript"));

    await new Promise((r) => setTimeout(r, 100));
    expect(connections).toBe(1);

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
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
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
      JSON.stringify({ type: "config", codec: "opus", lang: "en" }),
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
});
