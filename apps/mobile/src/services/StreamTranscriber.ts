import { PLAN_LIMITS } from "@/constants/billing";
import logger from "@/utils/logger";

export interface StreamConfig {
  token: string;
  lang: string;
  serverUrl: string;
  getToken?: () => string | null;
}

export interface TranscriptEvent {
  type: "interim" | "final";
  text: string;
  provider: string;
}

export interface StreamError {
  error: string;
  message: string;
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

type StreamCallback = (event: TranscriptEvent | StreamError) => void;
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
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  connect(config: StreamConfig): void {
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
          const data = JSON.parse(event.data as string) as ServerMessage;

          if (data.type === "ping") {
            this.sendJson({ type: "pong" });
            return;
          }

          if (data.type === "config_ack" || data.type === "config_request") {
            logger.info("[StreamTranscriber] Config negotiated", data);
            if (data.type === "config_request") {
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

          this.notifyCallbacks(
            data as unknown as TranscriptEvent | StreamError,
          );
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
          event.code !== 1000 &&
          this.reconnectAttempts < this.maxReconnectAttempts &&
          this.config
        ) {
          this.reconnectAttempts++;
          logger.info(
            `[StreamTranscriber] Reconnecting (attempt ${this.reconnectAttempts})`,
          );
          setTimeout(
            () => this.connect(this.config!),
            1000 * this.reconnectAttempts,
          );
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

  private notifyCallbacks(event: TranscriptEvent | StreamError): void {
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
