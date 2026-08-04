import { DurableObject } from "cloudflare:workers";
import { logger } from "./logger";
import * as assemblyai from "./providers/assemblyai";
import * as deepgram from "./providers/deepgram";
import * as gladia from "./providers/gladia";
import * as witai from "./providers/witai";
import { STREAM_STT_LANGUAGES } from "./languages";
import { getStreamingProviderNames, getLimits } from "./config";
import { guardLanguageCode, guardStreamDuration } from "./security";
import { initOpusDecoder } from "./utils/opus";
import { Env, Tier } from "./types";

// WebSocket close codes
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
// Reset the idle alarm at most this often to avoid a storage write per frame.
const IDLE_RESET_INTERVAL_MS = 15_000;

interface StreamPipelineEntry {
  name: string;
  skipOnAuto: boolean;
  supportedLanguages: ReadonlySet<string>;
  handleStream: (
    env: Env,
    lang: string,
    clientWs: WebSocket,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

const STREAMING_PROVIDER_MODULES: Record<
  string,
  {
    supportedLanguages: ReadonlySet<string>;
    handleStream: StreamPipelineEntry["handleStream"];
  }
> = {
  deepgram: {
    supportedLanguages: STREAM_STT_LANGUAGES.deepgram,
    handleStream: deepgram.handleStream,
  },
  witai: {
    supportedLanguages: STREAM_STT_LANGUAGES.witai,
    handleStream: witai.handleStream,
  },
  assemblyai: {
    supportedLanguages: STREAM_STT_LANGUAGES.assemblyai,
    handleStream: assemblyai.handleStream,
  },
  gladia: {
    supportedLanguages: STREAM_STT_LANGUAGES.gladia,
    handleStream: gladia.handleStream,
  },
};

const STREAMING_SKIP_AUTO: Record<string, boolean> = {
  deepgram: false,
  witai: true,
  assemblyai: false,
  gladia: false,
};

const STREAMING_PIPELINE: StreamPipelineEntry[] =
  getStreamingProviderNames().map((name) => ({
    name,
    skipOnAuto: STREAMING_SKIP_AUTO[name] ?? false,
    supportedLanguages:
      STREAMING_PROVIDER_MODULES[name]?.supportedLanguages ?? new Set(),
    handleStream:
      STREAMING_PROVIDER_MODULES[name]?.handleStream ??
      (() => Promise.resolve(false)),
  }));

/**
 * Session state is persisted per-connection via serializeAttachment so it
 * survives DO hibernation (in-memory fields are reset when a DO is evicted).
 */
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
}

interface StreamConnection {
  adapter: ClientWsAdapter;
  abortController: AbortController;
  pipelinePromise: Promise<void> | undefined;
}

/**
 * Minimal WebSocket-compatible facade over the accepted server socket.
 *
 * The streaming providers (`handleStream` implementations) forward client
 * audio via `addEventListener("message", ...)` on the client socket. The
 * Hibernation API delivers client messages through `webSocketMessage`
 * instead, and attaching event listeners to an accepted socket would defeat
 * hibernation. This adapter bridges the two: the DO routes messages in via
 * `emit()`, while providers keep working against the familiar listener API.
 * Early messages are buffered until a provider attaches its handler.
 */
class ClientWsAdapter {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private buffered: unknown[] = [];
  private readonly realWs: WebSocket;

  constructor(realWs: WebSocket) {
    this.realWs = realWs;
  }

  addEventListener(
    type: string,
    callback: (...args: unknown[]) => void,
  ): void {
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

/**
 * One Durable Object instance per user (routed via getByName(userId)).
 *
 * Moving streaming out of the stateless Worker gives us:
 *  - stable per-user session identity (the module-level `activeStreams` map
 *    in the old handler was per-isolate and could not enforce limits)
 *  - WebSocket Hibernation so idle connections don't accrue duration charges
 *  - alarms for idle / config-negotiation timeouts instead of setInterval
 *  - a hard per-user concurrent-stream cap via getWebSockets()
 */
export class StreamDurableObject extends DurableObject<Env> {
  private readonly connections = new Map<WebSocket, StreamConnection>();

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const tier = (url.searchParams.get("tier") as Tier | null) ?? "FREE";
    const lang = url.searchParams.get("lang") || "en";
    const limits = getLimits(tier);

    if (this.ctx.getWebSockets().length >= MAX_CONCURRENT_STREAMS) {
      logger.warn("[stream-do] Concurrent stream cap reached", { tier });
      return new Response(
        JSON.stringify({
          error: "TOO_MANY_CONNECTIONS",
          message: `Max ${MAX_CONCURRENT_STREAMS} concurrent stream(s) per user.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
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
    };
    server.serializeAttachment(state);

    const adapter = new ClientWsAdapter(server);
    this.connections.set(server, {
      adapter,
      abortController: new AbortController(),
      pipelinePromise: undefined,
    });

    this.ctx.acceptWebSocket(server);

    // Warm the Opus decoder for the streaming providers without blocking the
    // WebSocket handshake. This DO isolate is where the decoder actually runs
    // (the stateless worker isolate never needs it).
    void initOpusDecoder();

    // Start the config-negotiation timer (client usually sends config on open).
    await this.ctx.storage.setAlarm(Date.now() + CONFIG_NEGOTIATION_TIMEOUT_MS);

    const headers: Record<string, string> = {};
    // The client authenticates via the Sec-WebSocket-Protocol subprotocol
    // (keeps the JWT out of the query string). RFC 6455 requires the server
    // to select one of the requested protocols, so echo it back or the
    // client will fail the handshake.
    const subprotocol = request.headers.get("Sec-WebSocket-Protocol");
    if (subprotocol) headers["Sec-WebSocket-Protocol"] = subprotocol;

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
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
        state.lastIdleResetAt = now;
        if (
          typeof msg.lang === "string" &&
          msg.lang.trim() !== "" &&
          !state.providerStarted
        ) {
          const langGuard = guardLanguageCode(msg.lang.trim(), "lang");
          if (langGuard.allowed) {
            state.lang = msg.lang.trim();
            logger.info("[stream-do] Config negotiated language", { lang: state.lang });
          }
        }
        ws.serializeAttachment(state);
        this.safeSend(
          ws,
          JSON.stringify({ type: "config_ack", status: "ready" }),
        );
        await this.resetIdleAlarm(ws, state, now);
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

      // Other strings (e.g. non-config negotiation) — hand to the interceptor.
      this.forwardToAdapter(ws, message);
      await this.resetIdleAlarm(ws, state, now);
      return;
    }

    // Binary audio frame.
    if (state.limitExceeded) return;

    state.cumulativeBytes += message.byteLength;
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
          error: "FILE_TOO_LARGE",
          message: `Audio exceeds ${Math.round(state.maxAudioBytes / 1024 / 1024)}MB limit.`,
        }),
      );
      this.closeSession(ws, WS_CLOSE.NORMAL, "File too large");
      return;
    }

    // Persist session state at most every IDLE_RESET_INTERVAL_MS to avoid a
    // storage write per audio frame (resetIdleAlarm keeps the alarm fresh).
    if (now - state.lastIdleResetAt >= IDLE_RESET_INTERVAL_MS) {
      ws.serializeAttachment(state);
    }
    this.forwardToAdapter(ws, message);
    await this.resetIdleAlarm(ws, state, now);
    // Providers may start on the first audio frame even without a config msg.
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
      // Lets interceptors flush buffered PCM and close the provider socket.
      conn.adapter.emit("close", { code, reason, wasClean });
      try {
        conn.abortController.abort();
      } catch {
        /* ignore */
      }
      this.connections.delete(ws);
    }
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
          // Prod the client for its config message.
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
          // Config never arrived.
          this.safeSend(
            ws,
            JSON.stringify({
              error: "CONFIG_TIMEOUT",
              message: "Client did not send config within timeout.",
            }),
          );
          this.closeSession(ws, WS_CLOSE.NORMAL, "Config timeout");
        }
      } else {
        this.closeSession(ws, WS_CLOSE.IDLE_TIMEOUT, "Idle timeout");
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
  ): Promise<void> {
    if (now - state.lastIdleResetAt < IDLE_RESET_INTERVAL_MS) return;
    state.lastIdleResetAt = now;
    ws.serializeAttachment(state);
    await this.ctx.storage.setAlarm(now + IDLE_TIMEOUT_MS);
  }

  private forwardToAdapter(ws: WebSocket, data: string | ArrayBuffer): void {
    const conn = this.connections.get(ws);
    if (conn) conn.adapter.emit("message", data);
  }

  private startProviderPipeline(
    ws: WebSocket,
    state: SessionState,
  ): void {
    const conn = this.connections.get(ws);
    if (!conn || conn.pipelinePromise || state.providerStarted) return;

    conn.pipelinePromise = this.runProviderPipeline(ws, state, conn).finally(
      () => {
        conn.pipelinePromise = undefined;
      },
    );
  }

  private async runProviderPipeline(
    ws: WebSocket,
    state: SessionState,
    conn: StreamConnection,
  ): Promise<void> {
    let providerFound = false;

    for (const entry of STREAMING_PIPELINE) {
      if (entry.skipOnAuto && state.lang === "auto") {
        logger.info("[stream-do] Skipping provider (auto-detect unsupported)", {
          name: entry.name,
        });
        continue;
      }
      if (state.lang !== "auto" && !entry.supportedLanguages.has(state.lang)) {
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
        const handled = await entry.handleStream(
          this.env,
          state.lang,
          conn.adapter as unknown as WebSocket,
          conn.abortController.signal,
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
          error: "NO_PROVIDER_AVAILABLE",
          message: "No transcription provider could be reached.",
        }),
      );
      this.closeSession(ws, WS_CLOSE.NO_PROVIDER, "No provider");
    }
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
