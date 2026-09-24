export interface FakeWebSocketOptions {
  failUrls?: string[];

  neverOpenUrls?: string[];
}

export class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  closed = false;
  sent: unknown[] = [];
  private listeners = new Map<string, Array<(ev?: unknown) => void>>();

  constructor(url: string, opts?: FakeWebSocketOptions) {
    this.url = url;
    const fail = opts?.failUrls ?? ["fail"];
    const never = opts?.neverOpenUrls ?? ["never"];

    if (fail.some((s) => url.includes(s))) {
      queueMicrotask(() => this.emit("error", {}));
    } else if (never.some((s) => url.includes(s))) {
    } else {
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
      });
    }
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
