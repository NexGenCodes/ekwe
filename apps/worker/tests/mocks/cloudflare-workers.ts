// Test-only stub for the Workers runtime module `cloudflare:workers`.
// The real module only exists in the Cloudflare runtime; vitest runs in Node.
export class DurableObject<Env = unknown, Props = unknown> {
  protected ctx: DurableObjectState & Props;
  protected env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx as DurableObjectState & Props;
    this.env = env;
  }
}

// Minimal shape used by the DO in this repo.
export interface DurableObjectState {
  storage: {
    setAlarm(at: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T>;
}
