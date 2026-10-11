import {
  streamServerMessageSchema,
  type StreamControlMessage,
  type StreamError,
  type StreamTranscriptEvent,
} from "@ekwe/shared";

import { PLAN_LIMITS } from "@/constants/billing";
import logger from "@/utils/logger";

export interface StreamConfig {
  token: string;
  lang: string;
  serverUrl: string;
  getToken?: () => string | null;
}

/**
 * Every server message reaches the consumer, not just transcripts.
 *
 * Control messages carry the session's state — which provider is actually
 * speaking, what language was detected, that the socket is open. Forwarding
 * only transcripts meant a caller could not tell a healthy session from one the
 * worker had quietly moved off its primary provider.
 */
type StreamCallback = (
  event: StreamTranscriptEvent | StreamError | StreamControlMessage,
) => void;
type StreamStatusCallback = (
  status: "connecting" | "connected" | "disconnected" | "error",
) => void;

class StreamTranscriberClass {
  private ws: WebSocket | null = null;
  private config: StreamConfig | null = null;
  private callbacks: Set<StreamCallback> = new Set();
  private statusCallbacks: Set<StreamStatusCallback> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private droppedPcmChunks = 0;

  private static readonly NON_RETRYABLE_CLOSE_CODES = new Set([
    1000, 4004, 4005,
  ]);
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(config: StreamConfig): void {
    if (!config) return;
    this.teardown(false);
    this.config = config;
    this.startTime = Date.now();
    this.notifyStatus("connecting");

    const token = config.getToken?.() ?? config.token;
    const wsBase = config.serverUrl.replace(/^http/, "ws");
    const query = new URLSearchParams({
      lang: config.lang,
    });
    const url = `${wsBase}/transcribe/stream?${query.toString()}`;

    try {
      this.ws = new WebSocket(url, [token]);

      this.ws.onopen = (): void => {
        logger.info("[StreamTranscriber] Connected");
        this.reconnectAttempts = 0;
        this.droppedPcmChunks = 0;
        this.notifyStatus("connected");

        this.sendJson({
          type: "config",
          lang: config.lang,
          format: "pcm_s16le",
          sampleRate: 16000,
          channels: 1,
          frameSizeMs: 20,
        });

        const maxDuration = PLAN_LIMITS.pro.maxStreamDurationMs;
        if (maxDuration > 0) {
          this.durationTimer = setTimeout(() => {
            logger.info(
              "[StreamTranscriber] Max duration reached, disconnecting",
            );
            this.disconnect();
          }, maxDuration);
        }

        this.pingTimer = setInterval(() => {
          this.sendJson({ type: "pong" });
        }, 15_000);
      };

      this.ws.onmessage = (event: MessageEvent): void => {
        try {
          const parsed = streamServerMessageSchema.safeParse(
            JSON.parse(event.data as string),
          );
          if (!parsed.success) {
            logger.warn(
              "[StreamTranscriber] Dropping unparseable server message",
              parsed.error.issues,
            );
            return;
          }

          const msg = parsed.data;

          if ("type" in msg) {
            if (msg.type === "ping") {
              this.sendJson({ type: "pong" });
              return;
            }

            if (msg.type === "config_ack" || msg.type === "config_request") {
              logger.info("[StreamTranscriber] Config negotiated", msg);
              if (msg.type === "config_request") {
                this.sendJson({
                  type: "config",
                  lang: this.config?.lang,
                  format: "pcm_s16le",
                  sampleRate: 16000,
                  channels: 1,
                  frameSizeMs: 20,
                });
              }
              return;
            }

            if (msg.type === "interim" || msg.type === "final") {
              this.notifyCallbacks(msg);
              return;
            }

            // Control messages the server sends for the client's benefit.
            // They used to fall through to a bare `return`, which discarded the
            // only signal that a stream was viable, that the detected language
            // changed, or that the worker had silently swapped providers
            // mid-session.
            if (msg.type === "ready") {
              logger.info("[StreamTranscriber] Provider socket open", {
                route: msg.route,
                provider: msg.provider,
              });
              this.notifyCallbacks(msg);
              return;
            }

            if (msg.type === "language_detected") {
              logger.info("[StreamTranscriber] Language detected", {
                language: msg.language,
                provider: msg.provider,
              });
              this.notifyCallbacks(msg);
              return;
            }

            if (msg.type === "provider_switch") {
              logger.info("[StreamTranscriber] Provider switched", {
                from: msg.from,
                to: msg.to,
                reason: msg.reason,
                languageReset: msg.languageReset ?? false,
              });
              this.notifyCallbacks(msg);
              return;
            }

            // `stop` means the worker ended the session deliberately. Interim
            // text already delivered stays delivered; the close event that
            // follows carries the reason.
            if (msg.type === "stop") {
              logger.info("[StreamTranscriber] Server ended the session");
              return;
            }

            logger.warn(
              "[StreamTranscriber] Unhandled server message",
              (msg as { type?: string }).type,
            );
            return;
          }

          this.notifyCallbacks(msg);
        } catch {
          // Non-JSON message, ignore
        }
      };

      this.ws.onerror = (error: Event): void => {
        logger.error("[StreamTranscriber] WebSocket error", error);
        this.notifyStatus("error");
        this.notifyCallbacks({
          error: "WS_ERROR",
          message: "Connection error",
        });
      };

      this.ws.onclose = (event: CloseEvent): void => {
        logger.info("[StreamTranscriber] Disconnected", {
          code: event.code,
          reason: event.reason,
        });
        this.notifyStatus("disconnected");
        this.cleanup();

        if (
          this.config &&
          this.reconnectAttempts < this.maxReconnectAttempts &&
          !StreamTranscriberClass.NON_RETRYABLE_CLOSE_CODES.has(event.code)
        ) {
          this.reconnectAttempts++;
          logger.info(
            `[StreamTranscriber] Reconnecting (attempt ${this.reconnectAttempts})`,
          );
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.config) {
              this.connect(this.config);
            }
          }, 1000 * this.reconnectAttempts);
        } else {
          logger.error(
            `[StreamTranscriber] Giving up after ${this.reconnectAttempts} reconnect attempts`,
          );
          this.notifyCallbacks({
            error: "WS_CLOSED",
            message: "Lost the transcription connection",
          });
        }
      };
    } catch (err) {
      logger.error("[StreamTranscriber] Failed to create WebSocket", err);
      this.notifyStatus("error");
    }
  }

  sendPcm(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      return;
    }
    if (this.droppedPcmChunks === 0) {
      logger.warn(
        "[StreamTranscriber] Dropping audio while the socket is not open",
      );
    }
    this.droppedPcmChunks++;
  }

  disconnect(): void {
    this.teardown(true);
  }

  /**
   * Close the socket and cancel its timers.
   *
   * `notify` is false for a reconnect, which must not look like a
   * user-initiated disconnect or look like a clean stop. Resetting
   * `reconnectAttempts` on that path is what made maxReconnectAttempts
   * unreachable and turned a dead endpoint into an endless 1s reconnect loop.
   */
  private teardown(notify: boolean): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;
    }
    this.config = null;
    this.droppedPcmChunks = 0;
    if (notify) {
      this.reconnectAttempts = 0;
      this.notifyStatus("disconnected");
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  addCallback(cb: StreamCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  addStatusCallback(cb: StreamStatusCallback): () => void {
    this.statusCallbacks.add(cb);
    return () => this.statusCallbacks.delete(cb);
  }

  private sendJson(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private notifyCallbacks(
    event: StreamTranscriptEvent | StreamError | StreamControlMessage,
  ): void {
    this.callbacks.forEach((cb) => cb(event));
  }

  private notifyStatus(
    status: "connecting" | "connected" | "disconnected" | "error",
  ): void {
    this.statusCallbacks.forEach((cb) => cb(status));
  }

  private cleanup(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

export const StreamTranscriber = new StreamTranscriberClass();
