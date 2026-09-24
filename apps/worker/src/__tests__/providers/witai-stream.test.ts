import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  decoder: { ready: false },
  frame: { value: new Int16Array(160) },
}));

vi.mock("@/utils/opus", () => ({
  isOpusDecoderReady: vi.fn(() => h.decoder.ready),
  decodeOpusFrame: vi.fn((_frame: Uint8Array): Int16Array | null => {
    return h.frame.value;
  }),
}));

import { sttStream, MAX_PENDING_OPUS_FRAMES } from "@/providers/witai";
import { isOpusDecoderReady, decodeOpusFrame } from "@/utils/opus";
import { mockEnv } from "@/__tests__/setup";

const WAIT_MS = 60;
const wait = (ms = WAIT_MS): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class FakeWebSocket {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  sent: Array<{ type: string; text: string; provider: string }> = [];

  addEventListener(type: string, cb: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  removeEventListener(type: string, cb: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  dispatch(type: string, event: unknown): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(event);
  }

  send(data: string): void {
    this.sent.push(
      JSON.parse(data) as { type: string; text: string; provider: string },
    );
  }

  close(): void {}
}

function opusFrame(seed: number): ArrayBuffer {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint32(0, seed, true);
  return bytes.buffer;
}

function frameSeed(frame: Uint8Array | ArrayBuffer): number {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
}

describe("witai#sttStream opus decode buffering", () => {
  let fetchStub: ReturnType<typeof vi.fn>;
  let capturedBody: ReadableStream<Uint8Array> | null;
  let responseController: ReadableStreamDefaultController<Uint8Array> | null;

  const feed = (text: string): void => {
    responseController?.enqueue(new TextEncoder().encode(text));
  };
  const endResponse = (): void => {
    responseController?.close();
  };

  beforeEach(() => {
    h.decoder.ready = false;
    capturedBody = null;
    responseController = null;
    fetchStub = vi.fn(
      async (_url: string, init: RequestInit): Promise<Response> => {
        capturedBody = init.body as unknown as ReadableStream<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            responseController = controller;
          },
        });
        return new Response(stream, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function recordOutbound(): { recorded: Uint8Array[] } {
    const recorded: Uint8Array[] = [];
    const reader = capturedBody!.getReader();
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        recorded.push(value);
      }
    })();
    return { recorded };
  }

  async function startSession(): Promise<{
    ws: FakeWebSocket;
    handlePromise: Promise<boolean>;
  }> {
    const ws = new FakeWebSocket();
    const abort = new AbortController();
    const handlePromise = sttStream(
      mockEnv({ WIT_KEY_EN: "test-key" }),
      "en",
      ws as unknown as WebSocket,
      abort.signal,
    );
    await wait();
    return { ws, handlePromise };
  }

  test("holds frames while decoder initializes; emits WAV (never raw opus) once ready", async () => {
    const { ws, handlePromise } = await startSession();
    const { recorded } = recordOutbound();

    ws.dispatch("message", { data: opusFrame(1) } as unknown as MessageEvent);
    ws.dispatch("message", { data: opusFrame(2) } as unknown as MessageEvent);
    await wait();

    expect(decodeOpusFrame).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);

    h.decoder.ready = true;
    for (let i = 3; i < 26; i++) {
      ws.dispatch("message", { data: opusFrame(i) } as unknown as MessageEvent);
    }
    await wait();

    expect(decodeOpusFrame).toHaveBeenCalledTimes(2 + (26 - 3));
    expect(recorded.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(recorded[0].slice(0, 4))).toBe("RIFF");

    feed('{"type":"final","text":"hello world"}\n');
    endResponse();
    await expect(handlePromise).resolves.toBe(true);
    expect(ws.sent.at(-1)).toMatchObject({
      type: "final",
      text: "hello world",
      provider: "witai",
    });
  });

  test("caps the pending buffer, dropping the OLDEST frames on overflow", async () => {
    const { ws, handlePromise } = await startSession();

    for (let i = 0; i < MAX_PENDING_OPUS_FRAMES + 1; i++) {
      ws.dispatch("message", { data: opusFrame(i) } as unknown as MessageEvent);
    }
    await wait();
    expect(decodeOpusFrame).not.toHaveBeenCalled();

    h.decoder.ready = true;
    ws.dispatch("message", {
      data: opusFrame(9999),
    } as unknown as MessageEvent);
    await wait();

    expect(decodeOpusFrame).toHaveBeenCalledTimes(MAX_PENDING_OPUS_FRAMES + 1);
    const decoded = vi
      .mocked(decodeOpusFrame)
      .mock.calls.map(([frame]) => frameSeed(frame));
    expect(decoded).not.toContain(0);
    expect(decoded).toContain(1);
    expect(decoded).toContain(9999);

    feed('{"type":"final","text":"capped"}\n');
    endResponse();
    await expect(handlePromise).resolves.toBe(true);
  });

  test("returns false when no API key is configured", async () => {
    const ws = new FakeWebSocket();
    const abort = new AbortController();
    const handled = await sttStream(
      mockEnv({ WIT_KEY_EN: "" }),
      "en",
      ws as unknown as WebSocket,
      abort.signal,
    );
    expect(handled).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(isOpusDecoderReady).not.toHaveBeenCalled();
  });
});
