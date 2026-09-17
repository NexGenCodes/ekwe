import {
  streamServerMessageSchema,
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

type StreamCallback = (event: StreamTranscriptEvent | StreamError) => void;
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

  // Server close codes from the worker (see durable/stream-do.ts) that are
  // deliberate, non-recoverable session-terminating decisions. Reconnecting
  // after one of these must NOT happen: 4004 (no provider available) won't
  // resolve with a retry, and 4005 (duration exceeded) would reset the
  // server-side startTime on a fresh connection and bypass the per-session
  // duration cap.
  private static readonly NON_RETRYABLE_CLOSE_CODES = new Set([
    1000, 4004, 4005,
  ]);
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(config: StreamConfig): void {
    if (!config) return;
    this.disconnect();
    this.config = config;
    this.startTime = Date.now();
    this.notifyStatus("connecting");

    const token = config.getToken?.() ?? config.token;
    const wsBase = config.serverUrl.replace(/^http/, "ws");
    // Keep the JWT out of the query string: it rides the Sec-WebSocket-Protocol
    // subprotocol instead (RFC 6455), so it never hits logs or proxies.
    const query = new URLSearchParams({
      lang: config.lang,
    });
    const url = `${wsBase}/transcribe/stream?${query.toString()}`;

    try {
      this.ws = new WebSocket(url, [token]);

      this.ws.onopen = (): void => {
        logger.info("[StreamTranscriber] Connected");
        this.reconnectAttempts = 0;
        this.notifyStatus("connected");

        this.sendJson({
          type: "config",
          lang: config.lang,
          codec: "opus",
          sampleRate: 16000,
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
                  codec: "opus",
                  sampleRate: 16000,
                  frameSizeMs: 20,
                });
              }
              return;
            }

            if (msg.type === "interim" || msg.type === "final") {
              this.notifyCallbacks(msg);
              return;
            }

            // Any future typed server frame is not consumed here.
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
          // Track the timer so disconnect() can cancel a pending reconnect —
          // otherwise a stale timer would call connect(null) after config was
          // cleared and throw.
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.config) {
              this.connect(this.config);
            }
          }, 1000 * this.reconnectAttempts);
        }
      };
    } catch (err) {
      logger.error("[StreamTranscriber] Failed to create WebSocket", err);
      this.notifyStatus("error");
    }
  }

  sendOpus(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  disconnect(): void {
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
    this.reconnectAttempts = 0;
    this.notifyStatus("disconnected");
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

  private notifyCallbacks(event: StreamTranscriptEvent | StreamError): void {
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
