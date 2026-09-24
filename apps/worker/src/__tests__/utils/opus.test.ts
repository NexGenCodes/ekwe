import { describe, test, expect, vi, afterEach } from "vitest";
import {
  initOpusDecoder,
  decodeOpusFrame,
  isOpusDecoderReady,
  resetOpusDecoder,
} from "@/utils/opus";
import { createOpusDecodingInterceptor } from "@/utils/stream";
import { FakeWebSocket } from "@/__tests__/helpers/fake-websocket";

afterEach(() => {
  vi.unstubAllGlobals();
  resetOpusDecoder();
});

describe("opus decoder", () => {
  test("is not ready before initialization", () => {
    expect(isOpusDecoderReady()).toBe(false);
  });

  test("returns null for frames when the decoder is not ready", () => {
    const pcm = decodeOpusFrame(new Uint8Array([0x78, 0x00, 0x00]));
    expect(pcm).toBeNull();
  });

  test("initializes the WASM decoder", async () => {
    const ok = await initOpusDecoder();
    expect(ok).toBe(true);
    expect(isOpusDecoderReady()).toBe(true);
  });

  test("decodes a mono opus frame to PCM", async () => {
    await initOpusDecoder();
    const pcm = decodeOpusFrame(new Uint8Array([0x78, 0x00, 0x00]));
    expect(pcm).toBeInstanceOf(Int16Array);
    expect(pcm!.length).toBeGreaterThan(0);
  });

  test("decodes an ArrayBuffer opus frame", async () => {
    await initOpusDecoder();
    const pcm = decodeOpusFrame(new Uint8Array([0x78, 0x00, 0x00]).buffer);
    expect(pcm!.length).toBeGreaterThan(0);
  });

  test("returns null for an empty packet", async () => {
    await initOpusDecoder();
    const pcm = decodeOpusFrame(new Uint8Array([]));
    expect(pcm).toBeNull();
  });
});

describe("createOpusDecodingInterceptor with decoder not ready", () => {
  test("forwards raw binary when the decoder is not ready", () => {
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );
    const data = new Uint8Array([1, 2, 3]).buffer;

    client.emit("message", { data });

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(provider.sent[0] as Uint8Array)).toEqual([1, 2, 3]);
    cleanup();
  });

  test("forwards raw Blob bytes when the decoder is not ready", async () => {
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );
    const blob = new Blob([new Uint8Array([9, 8])]);

    client.emit("message", { data: blob });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.sent).toHaveLength(1);
    expect(Array.from(provider.sent[0] as Uint8Array)).toEqual([9, 8]);
    cleanup();
  });

  test("closes both sockets on a stop message", () => {
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    client.emit("message", { data: JSON.stringify({ type: "stop" }) });

    expect(client.closed).toBe(true);
    expect(provider.closed).toBe(true);
    cleanup();
  });
});

describe("createOpusDecodingInterceptor with decoder ready", () => {
  test("forwards decoded PCM when the decoder is ready", async () => {
    await initOpusDecoder();
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    for (let i = 0; i < 10; i++) {
      client.emit("message", {
        data: new Uint8Array([0x78, 0x00, 0x00]).buffer,
      });
    }

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect((provider.sent[0] as ArrayBuffer).byteLength).toBeGreaterThan(0);
    cleanup();
  });

  test("wraps decoded PCM in WAV when wrapInWav is set", async () => {
    await initOpusDecoder();
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
      true,
    );

    for (let i = 0; i < 10; i++) {
      client.emit("message", {
        data: new Uint8Array([0x78, 0x00, 0x00]).buffer,
      });
    }

    expect(provider.sent).toHaveLength(1);
    const wav = new Uint8Array(provider.sent[0] as ArrayBuffer);
    expect(wav.length).toBeGreaterThan(44);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    cleanup();
  });

  test("flushes buffered PCM frames when the client closes", async () => {
    await initOpusDecoder();
    const client = new FakeWebSocket("ws://client.example");
    const provider = new FakeWebSocket("ws://provider.example");
    const cleanup = createOpusDecodingInterceptor(
      client as unknown as WebSocket,
      provider as unknown as WebSocket,
      vi.fn(),
    );

    client.emit("message", { data: new Uint8Array([0x78, 0x00, 0x00]).buffer });
    client.emit("close", {});

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect((provider.sent[0] as ArrayBuffer).byteLength).toBeGreaterThan(0);
    cleanup();
  });
});
