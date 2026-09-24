import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { DurableObject } from "cloudflare:workers";
import { logger } from "@/core/logger";
import {
  getProviderModule,
  getProviderNamesFor,
  providerSupportsLanguage,
} from "@/providers";
import { getLimits } from "@/core/limits";
import { runPreflightGate } from "@/services/preflight";
import { trackBillableSuccess } from "@/services/usage";
import {
  guardLanguageCode,
  guardStreamDuration,
  guardWebSocketUpgrade,
} from "@/core/guards";
import { initOpusDecoder } from "@/utils/opus";
import { Env, SttStreamFn, Tier } from "@/core/types";

const WS_CLOSE = {
  NORMAL: 1000,
  IDLE_TIMEOUT: 4002,
  NO_PROVIDER: 4004,
  DURATION_EXCEEDED: 4005,
} as const;

const MAX_CONCURRENT_STREAMS = 3;
const IDLE_TIMEOUT_MS = 60_000;
const CONFIG_NEGOTIATION_TIMEOUT_MS = 5_000;
const CONFIG_NEGOTIATION_TOTAL_MS = CONFIG_NEGOTIATION_TIMEOUT_MS * 3;
const IDLE_RESET_INTERVAL_MS = 15_000;

interface StreamPipelineEntry {
  name: string;
  skipOnAuto: boolean;
  sttStream: SttStreamFn;
}

const STREAMING_SKIP_AUTO: Record<string, boolean> = {
  deepgram: false,
  witai: true,
  assemblyai: false,
  gladia: false,
};

const STREAMING_PIPELINE: StreamPipelineEntry[] = getProviderNamesFor(
  "sttStream",
  "PREMIUM",
).map((name) => ({
  name,
  skipOnAuto: STREAMING_SKIP_AUTO[name] ?? false,
  sttStream:
    getProviderModule(name)?.sttStream ?? (() => Promise.resolve(false)),
}));

interface SessionState {
  startTime: number;
  cumulativeBytes: number;
  limitExceeded: boolean;
  configReceived: boolean;
  configRequested: boolean;
  providerStarted: boolean;
  lang: string;
  tier: Tier;
  maxAudioBytes: number;
  lastIdleResetAt: number;
  billed: boolean;
}

interface StreamConnection {
  adapter: ClientWsAdapter;
  abortController: AbortController;
  pipelinePromise: Promise<void> | undefined;
  resumed: boolean;
}

class ClientWsAdapter {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private buffered: unknown[] = [];
  private readonly realWs: WebSocket;

  onFinalTranscript?: (ws: WebSocket, text: string) => void;

  constructor(realWs: WebSocket) {
    this.realWs = realWs;
  }

  addEventListener(type: string, callback: (...args: unknown[]) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(callback);
    if (type === "message" && this.buffered.length > 0) {
      const queued = this.buffered;
      this.buffered = [];
      for (const data of queued) this.emit("message", data);
    }
  }

  removeEventListener(
    type: string,
    callback: (...args: unknown[]) => void,
  ): void {
    this.handlers.get(type)?.delete(callback);
  }

  emit(type: string, data: unknown): void {
    const set = this.handlers.get(type);
    if (set && set.size > 0) {
      for (const cb of set) {
        try {
          cb({ data });
        } catch {
          /* handler errors must not kill the session */
        }
      }
    } else if (type === "message" && this.buffered.length < 256) {
      this.buffered.push(data);
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.realWs.readyState === WebSocket.OPEN) {
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data) as {
            type?: string;
            text?: string;
          };
          if (
            parsed?.type === "final" &&
            typeof parsed.text === "string" &&
            parsed.text.trim().length > 0
          ) {
            this.onFinalTranscript?.(this.realWs, parsed.text);
          }
        } catch {
          /* not JSON — already forwarded below */
        }
      }
      this.realWs.send(data as string | ArrayBuffer);
    }
  }

  close(code?: number, reason?: string): void {
    try {
      this.realWs.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  get readyState(): number {
    return this.realWs.readyState;
  }
}

export class StreamDurableObject extends DurableObject<Env> {
  private readonly connections = new Map<WebSocket, StreamConnection>();
  private readonly sessionBytes = new Map<WebSocket, number>();

  async fetch(request: Request): Promise<Response> {
    const upgradeGuard = guardWebSocketUpgrade(request);
    if (upgradeGuard) return upgradeGuard;

    const url = new URL(request.url);
    const tier = (url.searchParams.get("tier") as Tier | null) ?? "FREE";
    const lang = url.searchParams.get("lang") || "en";
    const sessionId = url.searchParams.get("sid");
    const limits = getLimits(tier);
    const userId = this.ctx.id.name ?? "";

    if (this.ctx.getWebSockets().length >= MAX_CONCURRENT_STREAMS) {
      logger.warn("[stream-do] Concurrent stream cap reached", { tier });
      return new Response(
        JSON.stringify({
          error: WORKER_ERROR_CODES.TOO_MANY_CONNECTIONS,
          message: `Max ${MAX_CONCURRENT_STREAMS} concurrent stream(s) per user.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    const gate = await runPreflightGate(
      this.env,
      this.ctx as unknown as ExecutionContext,
      userId,
      tier,
      "stream",
      sessionId,
    );
    if (!gate.ok) {
      logger.warn("[stream-do] Stream quota gate denied", {
        tier,
        status: gate.response.status,
      });
      return gate.response;
    }

    const [client, server] = Object.values(new WebSocketPair());

    const state: SessionState = {
      startTime: Date.now(),
      cumulativeBytes: 0,
      limitExceeded: false,
      configReceived: false,
      configRequested: false,
      providerStarted: false,
      lang,
      tier,
      maxAudioBytes: limits.maxAudioBytes,
      lastIdleResetAt: Date.now(),
      billed: false,
    };
    server.serializeAttachment(state);

    const adapter = new ClientWsAdapter(server);
    adapter.onFinalTranscript = (sock) => {
      this.billSessionIfNeeded(sock);
    };
    this.connections.set(server, {
      adapter,
      abortController: new AbortController(),
      pipelinePromise: undefined,
      resumed: false,
    });

    this.ctx.acceptWebSocket(server);

    void initOpusDecoder();

    await this.ctx.storage.setAlarm(Date.now() + CONFIG_NEGOTIATION_TIMEOUT_MS);

    const headers: Record<string, string> = {};
    const subprotocol = request.headers.get("Sec-WebSocket-Protocol");
    if (subprotocol) headers["Sec-WebSocket-Protocol"] = subprotocol;

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers,
    });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const state = (ws.deserializeAttachment() as SessionState | null) ?? null;
    if (!state) return;

    const now = Date.now();

    if (typeof message === "string") {
      let msg: Record<string, unknown> | null = null;
      try {
        msg = JSON.parse(message) as Record<string, unknown>;
      } catch {
        /* not JSON — treat as opaque string for the interceptor */
      }

      if (msg && msg.type === "config" && msg.codec === "opus") {
        state.configReceived = true;
        let langChanged = false;
        if (typeof msg.lang === "string" && msg.lang.trim() !== "") {
          const langGuard = guardLanguageCode(msg.lang.trim(), "lang");
          if (langGuard.allowed && msg.lang.trim() !== state.lang) {
            state.lang = msg.lang.trim();
            langChanged = true;
            logger.info("[stream-do] Config negotiated language", {
              lang: state.lang,
            });
          }
        }
        ws.serializeAttachment(state);
        this.safeSend(
          ws,
          JSON.stringify({ type: "config_ack", status: "ready" }),
        );

        if (state.providerStarted && langChanged) {
          const conn = this.connections.get(ws);
          if (conn) {
            conn.abortController.abort();
            conn.abortController = new AbortController();
            conn.pipelinePromise = undefined;
            state.providerStarted = false;
            ws.serializeAttachment(state);
          }
        }

        await this.resetIdleAlarm(ws, state, now, true);
        this.startProviderPipeline(ws, state);
        return;
      }

      if (msg && (msg.type === "pong" || msg.type === "ping")) {
        await this.resetIdleAlarm(ws, state, now);
        return;
      }

      if (msg && msg.type === "stop") {
        this.closeSession(ws, WS_CLOSE.NORMAL, "stop");
        return;
      }

      this.forwardToAdapter(ws, message);
      await this.resetIdleAlarm(ws, state, now);
      return;
    }

    if (state.limitExceeded) return;

    state.cumulativeBytes =
      (this.sessionBytes.get(ws) ?? state.cumulativeBytes) + message.byteLength;
    this.sessionBytes.set(ws, state.cumulativeBytes);
    const elapsedMs = now - state.startTime;

    const durationGuard = guardStreamDuration(elapsedMs, state.tier);
    if (!durationGuard.allowed) {
      state.limitExceeded = true;
      ws.serializeAttachment(state);
      this.closeSession(ws, WS_CLOSE.DURATION_EXCEEDED, "Duration exceeded");
      return;
    }

    if (state.cumulativeBytes > state.maxAudioBytes) {
      state.limitExceeded = true;
      ws.serializeAttachment(state);
      this.safeSend(
        ws,
        JSON.stringify({
          error: WORKER_ERROR_CODES.FILE_TOO_LARGE,
          message: `Audio exceeds ${Math.round(state.maxAudioBytes / 1024 / 1024)}MB limit.`,
        }),
      );
      this.closeSession(ws, WS_CLOSE.NORMAL, "File too large");
      return;
    }

    if (now - state.lastIdleResetAt >= IDLE_RESET_INTERVAL_MS) {
      ws.serializeAttachment(state);
    }
    this.forwardToAdapter(ws, message);
    await this.resetIdleAlarm(ws, state, now);
    this.startProviderPipeline(ws, state);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    logger.info("[stream-do] Client disconnected", { code, reason, wasClean });
    const conn = this.connections.get(ws);
    if (conn) {
      conn.adapter.emit("close", { code, reason, wasClean });
      try {
        conn.abortController.abort();
      } catch {
        /* ignore */
      }
      this.connections.delete(ws);
    }
    this.sessionBytes.delete(ws);
    this.billSessionIfNeeded(ws);
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    logger.error("[stream-do] Client socket error", { error: String(error) });
    const conn = this.connections.get(ws);
    if (conn) {
      conn.adapter.emit("error", {});
      try {
        conn.abortController.abort();
      } catch {
        /* ignore */
      }
      this.connections.delete(ws);
    }
    this.sessionBytes.delete(ws);
    this.billSessionIfNeeded(ws);
  }

  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    const now = Date.now();
    let needsReschedule: number | null = null;

    for (const ws of sockets) {
      const state = ws.deserializeAttachment() as SessionState | null;
      if (!state) continue;

      if (!state.configReceived) {
        if (!state.configRequested) {
          state.configRequested = true;
          ws.serializeAttachment(state);
          this.safeSend(
            ws,
            JSON.stringify({
              type: "config_request",
              codec: "opus",
              sampleRate: 16000,
              frameSizeMs: 20,
            }),
          );
          const next =
            now + (CONFIG_NEGOTIATION_TOTAL_MS - CONFIG_NEGOTIATION_TIMEOUT_MS);
          needsReschedule =
            needsReschedule === null ? next : Math.min(needsReschedule, next);
        } else {
          this.safeSend(
            ws,
            JSON.stringify({
              error: WORKER_ERROR_CODES.CONFIG_TIMEOUT,
              message: "Client did not send config within timeout.",
            }),
          );
          this.closeSession(ws, WS_CLOSE.NORMAL, "Config timeout");
        }
        continue;
      }

      const idleDeadline = state.lastIdleResetAt + IDLE_TIMEOUT_MS;
      if (now >= idleDeadline) {
        this.closeSession(ws, WS_CLOSE.IDLE_TIMEOUT, "Idle timeout");
      } else {
        needsReschedule =
          needsReschedule === null
            ? idleDeadline
            : Math.min(needsReschedule, idleDeadline);
      }
    }

    if (needsReschedule !== null) {
      await this.ctx.storage.setAlarm(needsReschedule);
    }
  }

  private async resetIdleAlarm(
    ws: WebSocket,
    state: SessionState,
    now: number,
    force = false,
  ): Promise<void> {
    if (!force && now - state.lastIdleResetAt < IDLE_RESET_INTERVAL_MS) return;
    state.lastIdleResetAt = now;
    ws.serializeAttachment(state);
    await this.ctx.storage.setAlarm(now + IDLE_TIMEOUT_MS);
  }

  private getOrCreateConnection(ws: WebSocket): StreamConnection {
    let conn = this.connections.get(ws);
    if (!conn) {
      conn = {
        adapter: new ClientWsAdapter(ws),
        abortController: new AbortController(),
        pipelinePromise: undefined,
        resumed: true,
      };
      conn.adapter.onFinalTranscript = (sock, _text) => {
        this.billSessionIfNeeded(sock);
      };
      this.connections.set(ws, conn);
    }
    return conn;
  }

  private billSessionIfNeeded(ws: WebSocket): void {
    try {
      const state = ws.deserializeAttachment() as SessionState | null;
      if (!state || state.billed) return;

      if (state.cumulativeBytes === 0 && !state.providerStarted) return;

      const elapsedMs = Date.now() - state.startTime;
      const billedMinutes = Math.max(1, Math.ceil(elapsedMs / 60000));

      state.billed = true;
      ws.serializeAttachment(state);
      logger.info("[stream-do] Billing stream session", { billedMinutes });
      trackBillableSuccess(
        this.env,
        this.ctx.id.name ?? "",
        "stream",
        this.ctx as unknown as ExecutionContext,
        billedMinutes,
      );
    } catch (err) {
      logger.error("[stream-do] Stream billing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private forwardToAdapter(ws: WebSocket, data: string | ArrayBuffer): void {
    this.getOrCreateConnection(ws).adapter.emit("message", data);
  }

  private startProviderPipeline(ws: WebSocket, state: SessionState): void {
    const conn = this.getOrCreateConnection(ws);
    if (conn.pipelinePromise) return;

    if (conn.resumed && state.providerStarted) {
      state.providerStarted = false;
      ws.serializeAttachment(state);
    }
    conn.resumed = false;

    const pipeline = this.runProviderPipeline(ws, state, conn).finally(() => {
      if (conn.pipelinePromise === pipeline) {
        conn.pipelinePromise = undefined;
      }
    });
    conn.pipelinePromise = pipeline;
  }

  private async runProviderPipeline(
    ws: WebSocket,
    state: SessionState,
    conn: StreamConnection,
  ): Promise<void> {
    const signal = conn.abortController.signal;
    let providerFound = false;

    for (const entry of STREAMING_PIPELINE) {
      if (entry.skipOnAuto && state.lang === "auto") {
        logger.info("[stream-do] Skipping provider (auto-detect unsupported)", {
          name: entry.name,
        });
        continue;
      }
      if (
        state.lang !== "auto" &&
        !providerSupportsLanguage(entry.name, "sttStream", state.lang)
      ) {
        logger.info("[stream-do] Skipping provider (unsupported language)", {
          name: entry.name,
          lang: state.lang,
        });
        continue;
      }

      logger.info("[stream-do] Trying provider", {
        name: entry.name,
        lang: state.lang,
      });
      try {
        const handled = await entry.sttStream(
          this.env,
          state.lang,
          conn.adapter as unknown as WebSocket,
          signal,
        );
        if (handled) {
          providerFound = true;
          state.providerStarted = true;
          ws.serializeAttachment(state);
          logger.info("[stream-do] Provider handling session", {
            name: entry.name,
          });
          break;
        }
      } catch (err) {
        logger.error("[stream-do] Provider threw", {
          name: entry.name,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      logger.warn("[stream-do] Provider unavailable, skipping", {
        name: entry.name,
      });
    }

    if (!providerFound) {
      this.safeSend(
        ws,
        JSON.stringify({
          error: WORKER_ERROR_CODES.NO_PROVIDER_AVAILABLE,
          message: "No transcription provider could be reached.",
        }),
      );
      this.closeSession(ws, WS_CLOSE.NO_PROVIDER, "No provider");
      return;
    }

    await new Promise<void>((resolve) => {
      const done = (): void => {
        ws.removeEventListener("close", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      if (signal.aborted) {
        resolve();
        return;
      }
      ws.addEventListener("close", done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  private safeSend(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      /* client may be gone */
    }
  }

  private closeSession(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
