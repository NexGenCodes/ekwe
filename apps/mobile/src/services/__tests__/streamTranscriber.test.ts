import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMock,
  default: loggerMock,
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: unknown[] = [];
  closeCalls: Array<{ code: number; reason: string }> = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code: number, reason: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = MockWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose(code = 1006, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

import { StreamTranscriber } from "@/services/streamTranscriber";

const config = {
  serverUrl: "https://worker.test",
  lang: "en",
  token: "token-1",
};

const pcm = new ArrayBuffer(320);

beforeEach(() => {
  MockWebSocket.instances.length = 0;
  vi.useFakeTimers();
  StreamTranscriber.disconnect();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StreamTranscriber reconnect backoff", () => {
  it("gives up after maxReconnectAttempts instead of retrying forever", () => {
    StreamTranscriber.connect(config);

    // Every socket the client opens dies before it ever opens. The first is the
    // initial connect, the rest are retries.
    for (let i = 0; i < 8; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws?.serverClose();
      vi.advanceTimersByTime(60_000);
    }

    const opened = MockWebSocket.instances.length;
    expect(opened).toBe(4);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining("Giving up"),
    );
  });

  it("escalates the delay between attempts", () => {
    StreamTranscriber.connect(config);
    MockWebSocket.instances[0]?.serverClose();

    // After 999ms the first retry has not been attempted yet.
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1]?.serverClose();
    // The second wait is 2s, so 1s is not enough.
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("resets the backoff after a connection succeeds", () => {
    StreamTranscriber.connect(config);
    MockWebSocket.instances[0]?.serverClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1]?.open();
    expect(MockWebSocket.instances[1]?.readyState).toBe(MockWebSocket.OPEN);

    // A later drop starts from 1s again rather than continuing to escalate.
    MockWebSocket.instances[1]?.serverClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("does not stop retrying because a reconnect looks like a disconnect", () => {
    StreamTranscriber.connect(config);
    MockWebSocket.instances[0]?.serverClose();
    vi.advanceTimersByTime(1000);
    MockWebSocket.instances[1]?.serverClose();
    vi.advanceTimersByTime(2000);
    MockWebSocket.instances[2]?.serverClose();

    // Three failures is the cap, so nothing beyond the third retry is opened.
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(4);
  });
});

describe("StreamTranscriber audio delivery", () => {
  it("forwards audio while the socket is open", () => {
    StreamTranscriber.connect(config);
    const ws = MockWebSocket.instances[0];
    ws?.open();

    StreamTranscriber.sendPcm(pcm);
    expect(ws?.sent).toContain(pcm);
  });

  it("reports dropped audio instead of discarding it silently", () => {
    StreamTranscriber.connect(config);
    // Never opened, so every chunk is unsendable.
    StreamTranscriber.sendPcm(pcm);
    StreamTranscriber.sendPcm(pcm);

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("Dropping audio"),
    );
    // Logged once per outage rather than once per 20ms frame.
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it("clears the drop report once a connection is re-established", () => {
    StreamTranscriber.connect(config);
    StreamTranscriber.sendPcm(pcm);
    loggerMock.warn.mockClear();

    MockWebSocket.instances[0]?.open();
    StreamTranscriber.sendPcm(pcm);
    StreamTranscriber.sendPcm(pcm);

    expect(loggerMock.warn).not.toHaveBeenCalled();
  });
});
