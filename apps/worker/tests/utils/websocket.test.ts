import { afterEach, describe, test, expect, vi } from "vitest";
import {
  rotateWsKeys,
  connectWithTimeout,
  createStreamInterceptor,
} from "../../src/utils/websocket";
import { mockEnv } from "../setup";
import { FakeWebSocket } from "../helpers/fake-websocket";

function makePair(): {
  client: FakeWebSocket;
  provider: FakeWebSocket;
} {
  return {
    client: new FakeWebSocket(
      "ws://client.example",
    ) as unknown as FakeWebSocket,
    provider: new FakeWebSocket(
      "ws://provider.example",
    ) as unknown as FakeWebSocket,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rotateWsKeys", () => {
  test("returns null without trying connections when no keys exist", async () => {
    const env = mockEnv({ DEEPGRAM_KEY_1: "", DEEPGRAM_KEY_2: "" });
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const buildUrl = vi.fn();

    const ws = await rotateWsKeys(env, "DEEPGRAM_KEY_", buildUrl);

    expect(ws).toBeNull();
    expect(buildUrl).not.toHaveBeenCalled();
  });

  test("tries keys until one connects", async () => {
    const env = mockEnv({
      DEEPGRAM_KEY_1: "key-one-abcde",
      DEEPGRAM_KEY_2: "key-two-abcde",
    });
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const buildUrl = vi.fn((key: string) =>
      key.includes("one") ? "ws://fail.example" : "ws://ok.example",
    );

    const ws = await rotateWsKeys(env, "DEEPGRAM_KEY_", buildUrl);

    expect(ws).not.toBeNull();
    expect(ws!.url).toBe("ws://ok.example");
    const calls = buildUrl.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
  });

  test("returns null when all keys fail", async () => {
    const env = mockEnv({
      DEEPGRAM_KEY_1: "key-one-abcde",
      DEEPGRAM_KEY_2: "key-two-abcde",
    });
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const buildUrl = vi.fn(() => "ws://fail.example");

    const ws = await rotateWsKeys(env, "DEEPGRAM_KEY_", buildUrl);

    expect(ws).toBeNull();
  });

  test("filters out short keys", async () => {
    const env = mockEnv({
      DEEPGRAM_KEY_1: "short",
      DEEPGRAM_KEY_2: "valid-key-2-abcde",
    });
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const buildUrl = vi.fn((key: string) =>
      key === "valid-key-2-abcde" ? "ws://ok.example" : "ws://fail.example",
    );

    const ws = await rotateWsKeys(env, "DEEPGRAM_KEY_", buildUrl);

    expect(ws).not.toBeNull();
    expect(buildUrl.mock.calls.every(([key]) => key !== "short")).toBe(true);
  });
});

describe("connectWithTimeout", () => {
  test("resolves with the websocket on open", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const ws = await connectWithTimeout("ws://ok.example");
    expect(ws).not.toBeNull();
    expect(ws!.readyState).toBe(FakeWebSocket.OPEN);
  });

  test("resolves null on error", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const ws = await connectWithTimeout("ws://fail.example");
    expect(ws).toBeNull();
  });

  test("resolves null when the connection times out", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
      const p = connectWithTimeout("ws://never.example");
      await vi.advanceTimersByTimeAsync(5001);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createStreamInterceptor", () => {
  test("forwards binary frames from client to provider", () => {
    const { client, provider } = makePair();
    const onMsg = vi.fn();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      onMsg,
    );
    const buf = new ArrayBuffer(4);

    client.emit("message", { data: buf });

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toBe(buf);
    cleanup();
  });

  test("forwards Blob frames from client to provider as bytes", async () => {
    const { client, provider } = makePair();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])]);

    client.emit("message", { data: blob });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(provider.sent[0] as ArrayBuffer))).toEqual(
      [1, 2, 3],
    );
    cleanup();
  });

  test("closes both sockets on a stop message", () => {
    const { client, provider } = makePair();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    client.emit("message", { data: JSON.stringify({ type: "stop" }) });

    expect(client.closed).toBe(true);
    expect(provider.closed).toBe(true);
    cleanup();
  });

  test("ignores non-stop messages", () => {
    const { client, provider } = makePair();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    client.emit("message", { data: JSON.stringify({ type: "transcript" }) });
    client.emit("message", { data: "not-json" });

    expect(client.closed).toBe(false);
    expect(provider.sent).toHaveLength(0);
    cleanup();
  });

  test("forwards provider text messages to the callback", () => {
    const { client, provider } = makePair();
    const onMsg = vi.fn();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      onMsg,
    );

    provider.emit("message", { data: "partial" });

    expect(onMsg).toHaveBeenCalledWith("partial");
    cleanup();
  });

  test("stops forwarding after cleanup", () => {
    const { client, provider } = makePair();
    const onMsg = vi.fn();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      onMsg,
    );

    cleanup();
    provider.emit("message", { data: "ignored" });
    client.emit("message", { data: "ignored-2" });

    expect(onMsg).not.toHaveBeenCalled();
    expect(provider.sent).toHaveLength(0);
    expect(client.closed).toBe(true);
  });

  test("closes both sockets when the client closes", () => {
    const { client, provider } = makePair();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    client.emit("close", {});

    expect(client.closed).toBe(true);
    expect(provider.closed).toBe(true);
    cleanup();
  });

  test("closes both sockets when the provider closes", () => {
    const { client, provider } = makePair();
    const cleanup = createStreamInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    provider.emit("close", {});

    expect(client.closed).toBe(true);
    expect(provider.closed).toBe(true);
    cleanup();
  });
});
