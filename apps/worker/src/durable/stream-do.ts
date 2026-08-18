import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { DurableObject } from "cloudflare:workers";
import { logger } from "../core/logger";
import * as assemblyai from "../providers/assemblyai";
import * as deepgram from "../providers/deepgram";
import * as gladia from "../providers/gladia";
import * as witai from "../providers/witai";
import { STREAM_STT_LANGUAGES } from "../services/languages";
import { getStreamingProviderNames } from "../core/config";
import { getLimits } from "../core/limits";
import { guardLanguageCode, guardStreamDuration, guardWebSocketUpgrade } from "../core/guards";
import { initOpusDecoder } from "../utils/opus";
import { Env, Tier } from "../core/types";

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
  /** True when this entry was rehydrated after DO hibernation (in-memory state was lost). */
  resumed: boolean;
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
  // Monotonic per-socket byte counters (see webSocketMessage): the persisted
  // attachment only snapshots cumulativeBytes every IDLE_RESET_INTERVAL_MS,
  // so without this in-isolate record the limit could be under-counted after
  // a hibernation restart.
  private readonly sessionBytes = new Map<WebSocket, number>();

  async fetch(request: Request): Promise<Response> {
    const upgradeGuard = guardWebSocketUpgrade(request);
    if (upgradeGuard) return upgradeGuard;

    const url = new URL(request.url);
    const tier = (url.searchParams.get("tier") as Tier | null) ?? "FREE";
    const lang = url.searchParams.get("lang") || "en";
    const limits = getLimits(tier);

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
      resumed: false,
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

        // If a provider is already running with a stale language (audio
        // arrived before config, or language changed mid-stream), abort the
        // current pipeline so startProviderPipeline can relaunch with the
        // correct language.
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

        // The session is now active. `force` replaces the config-negotiation
        // alarm armed in fetch() (now + 5s) with the idle timeout, otherwise a
        // healthy session would be torn down at +5s while audio is streaming.
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

      // Other strings (e.g. non-config negotiation) — hand to the interceptor.
      this.forwardToAdapter(ws, message);
      await this.resetIdleAlarm(ws, state, now);
      return;
    }

    // Binary audio frame.
    if (state.limitExceeded) return;

    // The persisted attachment resets on hibernation and is re-serialized at
    // most every IDLE_RESET_INTERVAL_MS, so increments made between
    // serializations would be lost after a restart and under-count the byte
    // limit. Seed the in-isolate counter from the last persisted baseline and
    // keep it monotonic for the socket's lifetime.
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
              error: WORKER_ERROR_CODES.CONFIG_TIMEOUT,
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
    force = false,
  ): Promise<void> {
    // Rate-limit alarm re-arms: setAlarm persists to DO storage, so avoid a
    // write per audio frame. `force` skips the throttle for the one-time
    // config→active transition where the idle alarm must replace the
    // config-negotiation alarm regardless of the elapsed window.
    if (!force && now - state.lastIdleResetAt < IDLE_RESET_INTERVAL_MS) return;
    state.lastIdleResetAt = now;
    ws.serializeAttachment(state);
    await this.ctx.storage.setAlarm(now + IDLE_TIMEOUT_MS);
  }

  /**
   * Returns the in-memory connection entry for a socket, rehydrating it lazily
   * after DO hibernation. When a DO is evicted, the `connections` Map is lost
   * but the accepted client socket (and its persisted attachment) survives, so
   * a new adapter/abort controller must be rebuilt on the next message.
   */
  private getOrCreateConnection(ws: WebSocket): StreamConnection {
    let conn = this.connections.get(ws);
    if (!conn) {
      conn = {
        adapter: new ClientWsAdapter(ws),
        abortController: new AbortController(),
        pipelinePromise: undefined,
        resumed: true,
      };
      this.connections.set(ws, conn);
    }
    return conn;
  }

  private forwardToAdapter(ws: WebSocket, data: string | ArrayBuffer): void {
    this.getOrCreateConnection(ws).adapter.emit("message", data);
  }

  private startProviderPipeline(ws: WebSocket, state: SessionState): void {
    const conn = this.getOrCreateConnection(ws);
    if (conn.pipelinePromise) return;

    // After hibernation the in-memory provider pipeline — and the provider
    // WebSocket it owned — is gone, even though `providerStarted` was persisted
    // in the attachment. Restart the pipeline from the rehydrated connection;
    // skipping this would leave the session silently muted.
    if (conn.resumed && state.providerStarted) {
      state.providerStarted = false;
      ws.serializeAttachment(state);
    }
    conn.resumed = false;

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
          error: WORKER_ERROR_CODES.NO_PROVIDER_AVAILABLE,
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
