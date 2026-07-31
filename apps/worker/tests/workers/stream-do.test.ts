import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { StreamDurableObject } from "../../src/stream-do";

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
  return env.STREAM_DO.getByName(name) as unknown as DurableObjectStub<StreamDurableObject>;
}

async function openSession(
  name: string,
  query = "",
): Promise<OpenedSession> {
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

    // With no provider keys in the test env, the session must close (4004).
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
    const body = (await res.json()) as { error: string };
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

    // Rewind the session start time so it looks 200s old (> 120s PREMIUM cap).
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
