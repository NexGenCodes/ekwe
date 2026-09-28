import {
  pinLanguage,
  streamRoutesFor,
  streamSkipReason,
  STREAM_AUDIO_FORMAT,
  STREAM_CHANNELS,
  STREAM_FRAME_MS,
  STREAM_SAMPLE_RATE,
  WORKER_ERROR_CODES,
  type StreamRoute,
} from "@ekwe/shared";
import { DurableObject } from "cloudflare:workers";
import { logger } from "@/core/logger";
import { getProviderModule, getStreamRoutes } from "@/providers";
import { isProviderDegraded } from "@/services/health";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";
import { getLimits } from "@/core/limits";
import { runPreflightGate } from "@/services/preflight";
import { trackBillableSuccess } from "@/services/usage";
import {
  guardLanguageCode,
  guardStreamDuration,
  guardWebSocketUpgrade,
} from "@/core/guards";
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

/** How long a failover waits for a device silence boundary before forcing on. */
const FAILOVER_SEAM_WAIT_MS = 1_500;

/** Replayed into a replacement provider so it is not starting mid-word. */
const FAILOVER_PRIMING_MS = 2_000;
const PRIME_BYTES_PER_MS = (STREAM_SAMPLE_RATE * 2) / 1000;

interface RouteEntry {
  route: StreamRoute;
  sttStream: SttStreamFn;
}

/** Only routes a provider module can actually serve. */
const STREAM_PIPELINE: RouteEntry[] = getStreamRoutes()
  .map((route) => ({
    route,
    sttStream:
      getProviderModule(route.provider)?.sttStream ??
      ((): Promise<boolean> => Promise.resolve(false)),
  }))
  .filter((e) => typeof e.sttStream === "function");

interface SessionState {
  startTime: number;
  cumulativeBytes: number;
  limitExceeded: boolean;
  configReceived: boolean;
  configRequested: boolean;
  providerStarted: boolean;
  /** Sticky: a provider has run in this session at least once. */
  providerEverStarted: boolean;
  /** What the client asked for: a concrete code, or "auto". */
  lang: string;
  /** Language a provider has claimed, or "auto" while unresolved. */
  pinnedLang: string;
  langCommitted: boolean;
  /** The device's own voice-activity gate, used to find a safe failover seam. */
  vadActive: boolean;
  /** When a deferred failover stops waiting, or null when none is pending. */
  failoverDeadlineAt: number | null;
  tier: Tier;
  maxAudioBytes: number;
  lastIdleResetAt: number;
  /** True once any usage has been reported for this session. */
  billed: boolean;
  /** Units reported so far, so each report is an increment rather than a total. */
  billedMinutes: number;
  /** Start of the stretch not yet reported, so sub-minute time is not lost. */
  billedSince: number;
}

interface StreamConnection {
  adapter: ClientWsAdapter;
  abortController: AbortController;
  /** True only while a route is being dialled, not for the provider's lifetime. */
  dialing: boolean;
  resumed: boolean;
  /** Route currently attached, for the provider_switch event. */
  activeRouteId: string | null;
  /** Rolling audio tail: primes a replacement and holds pre-attach frames. */
  priming: Uint8Array[];
  primingBytes: number;
  /** A failover that arrived mid-utterance, waiting for a silence boundary. */
  pendingFailover: boolean;
  triedRoutes: string[];
}

class ClientWsAdapter {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private buffered: Uint8Array[] = [];
  private bufferedBytes = 0;
  private readonly realWs: WebSocket;

  onFinalTranscript?: (ws: WebSocket, text: string) => void;
  onOutbound?: (data: string) => void;
  /** Read by the interceptor so a provider dying does not close the client. */
  onProviderGone?: (reason: "close" | "error") => void;

  constructor(realWs: WebSocket) {
    this.realWs = realWs;
  }

  addEventListener(type: string, callback: (...args: unknown[]) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(callback);
    if (type === "message" && this.buffered.length > 0) {
      const queued = this.buffered;
      this.buffered = [];
      this.bufferedBytes = 0;
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
      return;
    }
    if (type !== "message") return;
    // Bounded tail: covers a slow attach without unbounded growth.
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    if (!bytes || bytes.byteLength === 0) return;
    this.buffered.push(bytes);
    this.bufferedBytes += bytes.byteLength;
    while (
      this.bufferedBytes > FAILOVER_PRIMING_MS * PRIME_BYTES_PER_MS &&
      this.buffered.length > 1
    ) {
      this.bufferedBytes -= this.buffered.shift()!.byteLength;
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
      if (typeof data === "string") this.onOutbound?.(data);
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
      providerEverStarted: false,
      lang,
      pinnedLang: lang === "auto" ? "auto" : lang,
      langCommitted: false,
      vadActive: true,
      failoverDeadlineAt: null,
      tier,
      maxAudioBytes: limits.maxAudioBytes,
      lastIdleResetAt: Date.now(),
      billed: false,
      billedMinutes: 0,
      billedSince: Date.now(),
    };
    server.serializeAttachment(state);

    const adapter = new ClientWsAdapter(server);
    adapter.onFinalTranscript = (sock) => {
      this.billStint(sock);
    };
    adapter.onOutbound = (data) => this.onProviderMessage(server, data);
    const conn: StreamConnection = {
      adapter,
      abortController: new AbortController(),
      dialing: false,
      resumed: false,
      activeRouteId: null,
      priming: [],
      primingBytes: 0,
      pendingFailover: false,
      triedRoutes: [],
    };
    adapter.onProviderGone = () => this.onProviderGone(server, conn);
    this.connections.set(server, conn);

    this.ctx.acceptWebSocket(server);

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

      if (msg?.type === "config") {
        state.configReceived = true;
        let langChanged = false;
        if (typeof msg.lang === "string" && msg.lang.trim() !== "") {
          const langGuard = guardLanguageCode(msg.lang.trim(), "lang");
          if (!langGuard.allowed) {
            this.safeSend(ws, JSON.stringify(langGuard.response));
            this.closeSession(ws, WS_CLOSE.NORMAL, "Invalid language");
            return;
          }
          const requested = msg.lang.trim();
          if (requested !== state.lang) {
            state.lang = requested;
            state.pinnedLang = requested === "auto" ? "auto" : requested;
            state.langCommitted = false;
            langChanged = true;
          }
        }

        const skip = streamSkipReason(state.lang);
        if (skip) {
          this.safeSend(
            ws,
            JSON.stringify({
              error: WORKER_ERROR_CODES.LANGUAGE_UNSUPPORTED,
              message:
                skip === "auto-detect"
                  ? "No streaming provider can detect the language."
                  : `No streaming provider handles ${state.lang}.`,
            }),
          );
          this.closeSession(ws, WS_CLOSE.NO_PROVIDER, "Unsupported language");
          return;
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
            conn.dialing = false;
            conn.activeRouteId = null;
            conn.triedRoutes = [];
            conn.pendingFailover = false;
            state.providerStarted = false;
            state.failoverDeadlineAt = null;
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

      if (msg && msg.type === "vad" && typeof msg.active === "boolean") {
        const conn = this.connections.get(ws);
        state.vadActive = msg.active;
        ws.serializeAttachment(state);
        // Swap providers at the silence seam, with no speech in the gap.
        if (conn && conn.pendingFailover && !msg.active) {
          conn.pendingFailover = false;
          state.failoverDeadlineAt = null;
          conn.abortController.abort();
          conn.abortController = new AbortController();
          conn.dialing = false;
          this.startProviderPipeline(ws, state);
        }
        return;
      }

      if (msg && msg.type === "stop") {
        this.closeSession(ws, WS_CLOSE.NORMAL, "stop");
        return;
      }

      if (msg && msg.type === "force_endpoint") {
        const conn = this.connections.get(ws);
        // Wit is an HTTP pipe and cannot be told to end a turn.
        if (conn?.activeRouteId && conn.activeRouteId !== "witai") {
          conn.adapter.emit("control", "force_endpoint");
        }
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
    this.recordPriming(this.getOrCreateConnection(ws), message);
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
    this.billStint(ws, true);
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
    this.billStint(ws, true);
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
    this.billStint(ws, true);
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
              format: STREAM_AUDIO_FORMAT,
              sampleRate: STREAM_SAMPLE_RATE,
              channels: STREAM_CHANNELS,
              frameSizeMs: STREAM_FRAME_MS,
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

      if (
        state.failoverDeadlineAt !== null &&
        now >= state.failoverDeadlineAt
      ) {
        // No silence boundary arrived in time, so take the seam anyway.
        state.failoverDeadlineAt = null;
        ws.serializeAttachment(state);
        const conn = this.connections.get(ws);
        if (conn?.pendingFailover) this.startProviderPipeline(ws, state);
      }

      const idleDeadline = state.lastIdleResetAt + IDLE_TIMEOUT_MS;
      if (now >= idleDeadline) {
        this.closeSession(ws, WS_CLOSE.IDLE_TIMEOUT, "Idle timeout");
      } else {
        needsReschedule =
          needsReschedule === null
            ? idleDeadline
            : Math.min(needsReschedule, idleDeadline);
        if (state.failoverDeadlineAt !== null) {
          needsReschedule = Math.min(needsReschedule, state.failoverDeadlineAt);
        }
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
    await this.scheduleNextAlarm(state);
  }

  /** Arms the alarm for whichever deadline comes first. */
  private async scheduleNextAlarm(state: SessionState): Promise<void> {
    const deadlines = [state.lastIdleResetAt + IDLE_TIMEOUT_MS];
    if (state.failoverDeadlineAt !== null) {
      deadlines.push(state.failoverDeadlineAt);
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  private getOrCreateConnection(ws: WebSocket): StreamConnection {
    const existing = this.connections.get(ws);
    if (existing) return existing;

    const adapter = new ClientWsAdapter(ws);
    const conn: StreamConnection = {
      adapter,
      abortController: new AbortController(),
      dialing: false,
      resumed: true,
      activeRouteId: null,
      priming: [],
      primingBytes: 0,
      pendingFailover: false,
      triedRoutes: [],
    };
    adapter.onFinalTranscript = (sock) => this.billStint(sock);
    adapter.onOutbound = (data) => this.onProviderMessage(ws, data);
    // Set before any provider socket exists.
    adapter.onProviderGone = () => this.onProviderGone(ws, conn);
    this.connections.set(ws, conn);
    return conn;
  }

  /** Pins the language from the first provider that asserts one. */
  private onProviderMessage(ws: WebSocket, data: string): void {
    const state = ws.deserializeAttachment() as SessionState | null;
    if (!state || state.pinnedLang !== "auto") return;

    let msg: { type?: string; language?: string; provider?: string };
    try {
      msg = JSON.parse(data) as { type?: string; language?: string };
    } catch {
      return;
    }
    if (msg.type !== "final" || !msg.language) return;

    const code = canonicalLanguageFromName(msg.language);
    if (!code) return;

    const next = pinLanguage(null, code, state.langCommitted);
    if (!next) return;

    state.pinnedLang = next;
    state.langCommitted = true;
    ws.serializeAttachment(state);
    logger.info("[stream-do] Language pinned", {
      language: next,
      route: this.connections.get(ws)?.activeRouteId,
    });
    this.safeSend(
      ws,
      JSON.stringify({
        type: "language_detected",
        language: next,
        provider: this.connections.get(ws)?.activeRouteId ?? "",
      }),
    );
  }

  /**
   * Reports usage accrued since the last call, in whole minutes. The remainder
   * carries forward; the closing call rounds up, so a real session bills >= 1.
   */
  private billStint(ws: WebSocket, closing = false): void {
    try {
      const state = ws.deserializeAttachment() as SessionState | null;
      if (!state) return;
      if (!state.providerEverStarted) return;

      const now = Date.now();
      const elapsedMs = now - state.billedSince;
      const wholeMinutes = Math.floor(elapsedMs / 60_000);
      const remainderMs = elapsedMs % 60_000;

      const minutes = closing
        ? wholeMinutes + (remainderMs > 0 ? 1 : 0)
        : wholeMinutes;
      state.billedSince =
        closing || remainderMs === 0 ? now : now - remainderMs;

      if (minutes > 0) {
        state.billed = true;
        state.billedMinutes += minutes;
        logger.info("[stream-do] Billing stream usage", {
          minutes,
          total: state.billedMinutes,
        });
        trackBillableSuccess(
          this.env,
          this.ctx.id.name ?? "",
          "stream",
          this.ctx as unknown as ExecutionContext,
          minutes,
        );
      }
      ws.serializeAttachment(state);
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
    if (conn.dialing) return;

    if (conn.resumed) {
      // A woken DO has no provider socket, whatever the attachment claims.
      conn.resumed = false;
      state.providerStarted = false;
      ws.serializeAttachment(state);
    } else if (state.providerStarted) {
      return;
    }

    conn.dialing = true;
    void this.runProviderPipeline(ws, state, conn).finally(() => {
      conn.dialing = false;
    });
  }

  /** A pin wins; with no route to take it, the pin is released to auto. */
  private resolveNextLanguage(state: SessionState): {
    lang: string;
    languageReset: boolean;
  } {
    if (state.pinnedLang === "auto")
      return { lang: "auto", languageReset: false };
    if (streamRoutesFor(state.pinnedLang).length > 0) {
      return { lang: state.pinnedLang, languageReset: false };
    }
    logger.warn("[stream-do] No route covers the pinned language", {
      pinned: state.pinnedLang,
    });
    state.pinnedLang = "auto";
    state.langCommitted = false;
    return { lang: "auto", languageReset: true };
  }

  private async runProviderPipeline(
    ws: WebSocket,
    state: SessionState,
    conn: StreamConnection,
  ): Promise<void> {
    const previousRoute = conn.activeRouteId;
    const { lang, languageReset } = this.resolveNextLanguage(state);
    const effectiveLang = lang === "auto" ? state.lang : lang;
    let providerFound = false;

    for (const entry of STREAM_PIPELINE) {
      if (conn.triedRoutes.includes(entry.route.id)) continue;
      if (!streamRoutesFor(effectiveLang).includes(entry.route)) continue;
      if (await isProviderDegraded(this.env, entry.route.provider)) {
        logger.info("[stream-do] Skipping route (circuit open)", {
          route: entry.route.id,
        });
        continue;
      }

      conn.triedRoutes.push(entry.route.id);
      logger.info("[stream-do] Opening route", {
        route: entry.route.id,
        lang: effectiveLang,
      });

      let handled = false;
      try {
        handled = await entry.sttStream(
          this.env,
          entry.route,
          effectiveLang,
          conn.adapter as unknown as WebSocket,
          conn.abortController.signal,
        );
      } catch (err) {
        logger.error("[stream-do] Route threw", {
          route: entry.route.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (!handled) {
        logger.warn("[stream-do] Route unavailable", { route: entry.route.id });
        continue;
      }

      providerFound = true;
      conn.activeRouteId = entry.route.id;
      // The dial above awaited, so `state` predates it. Re-read before writing,
      // or this copy reverts whatever was written while the dial was in flight.
      const latest =
        (ws.deserializeAttachment() as SessionState | null) ?? state;
      latest.providerStarted = true;
      latest.providerEverStarted = true;
      ws.serializeAttachment(latest);

      this.safeSend(
        ws,
        JSON.stringify({
          type: "ready",
          route: entry.route.id,
          provider: entry.route.provider,
          format: entry.route.wire,
          sampleRate: STREAM_SAMPLE_RATE,
          channels: 1,
        }),
      );

      if (previousRoute && previousRoute !== entry.route.id) {
        this.safeSend(
          ws,
          JSON.stringify({
            type: "provider_switch",
            from: previousRoute,
            to: entry.route.id,
            reason: "route-failover",
            ...(languageReset ? { languageReset: true } : {}),
          }),
        );
      }
      break;
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

  /** A provider ending is not the end of the session: failover instead. */
  private onProviderGone(ws: WebSocket, conn: StreamConnection): void {
    const state = ws.deserializeAttachment() as SessionState | null;
    if (!state) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!conn.dialing && !state.providerStarted) return;

    const failed = conn.activeRouteId;
    logger.warn("[stream-do] Provider ended, attempting failover", {
      route: failed,
      speech: state.vadActive,
    });

    state.providerStarted = false;
    conn.activeRouteId = null;
    conn.abortController.abort();
    conn.abortController = new AbortController();
    conn.dialing = false;
    // `triedRoutes` survives so a dead route is not retried on every failover.
    ws.serializeAttachment(state);

    this.primeReplacement(conn);
    this.billStint(ws);

    if (state.vadActive) {
      conn.pendingFailover = true;
      state.failoverDeadlineAt = Date.now() + FAILOVER_SEAM_WAIT_MS;
      ws.serializeAttachment(state);
      void this.scheduleNextAlarm(state);
      return;
    }
    state.failoverDeadlineAt = null;
    ws.serializeAttachment(state);
    this.startProviderPipeline(ws, state);
  }

  /** Replays the audio tail so the replacement does not start cold. */
  private primeReplacement(conn: StreamConnection): void {
    const tail = conn.priming
      .map((p) => p.byteLength)
      .reduce((a, b) => a + b, 0);
    if (tail === 0) return;
    const merged = new Uint8Array(tail);
    let at = 0;
    for (const part of conn.priming) {
      merged.set(part, at);
      at += part.byteLength;
    }
    conn.priming = [];
    conn.primingBytes = 0;
    conn.adapter.emit("message", merged.buffer);
    logger.info("[stream-do] Primed replacement provider", {
      bytes: tail,
      ms: Math.round(tail / PRIME_BYTES_PER_MS),
    });
  }

  /** Keeps the rolling tail that failover primes from. */
  private recordPriming(conn: StreamConnection, data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (bytes.byteLength === 0) return;
    conn.priming.push(bytes);
    conn.primingBytes += bytes.byteLength;
    const cap = FAILOVER_PRIMING_MS * PRIME_BYTES_PER_MS;
    while (conn.primingBytes > cap && conn.priming.length > 1) {
      conn.primingBytes -= conn.priming.shift()!.byteLength;
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
    this.billStint(ws, true);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
