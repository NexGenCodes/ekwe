import { describe, test, expect, vi, afterEach } from "vitest";
import {
  initOpusDecoder,
  decodeOpusFrame,
  isOpusDecoderReady,
} from "../src/utils/opus";
import { createOpusDecodingInterceptor } from "../src/utils/websocket";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  closed = false;
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(ev?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, cb: (ev?: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(cb);
  }

  removeEventListener(type: string, cb: (ev?: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== cb),
    );
  }

  emit(type: string, ev?: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  send(data: unknown): void {
    this.sent.push(data);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
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
