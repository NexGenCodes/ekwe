import { useSelector } from "@legendapp/state/react";
import { useEffect, useRef, useState } from "react";

import { auth$ } from "@/store";
import logger from "@/utils/logger";

export interface StreamResult {
  text: string;
  isFinal: boolean;
}

export function useAudioStream(): {
  isStreaming: boolean;
  transcript: string;
  startStream: (sourceLang?: string) => Promise<void>;
  stopStream: () => void;
  sendAudioChunk: (base64Chunk: string) => void;
} {
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const sessionToken = useSelector(() => auth$.session.get()?.access_token);

  const startStream = async (sourceLang: string = "auto"): Promise<void> => {
    const WORKER_URL =
      process.env.EXPO_PUBLIC_WORKER_URL || "http://localhost:8787";
    const wsUrl = WORKER_URL.replace("http", "ws") + "/transcribe/stream";

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = (): void => {
      setIsStreaming(true);
      ws.send(
        JSON.stringify({
          type: "config",
          token: sessionToken,
          sourceLang,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent): void => {
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          text: string;
          isFinal?: boolean;
        };
        if (data.type === "transcript") {
          setTranscript(data.text);
        }
      } catch (err) {
        logger.error("WS parse error", err);
      }
    };

    ws.onclose = (): void => {
      setIsStreaming(false);
    };

    ws.onerror = (): void => {
      setIsStreaming(false);
    };
  };

  const sendAudioChunk = (base64Chunk: string): void => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "audio", data: base64Chunk }));
    }
  };

  const stopStream = (): void => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsStreaming(false);
  };

  useEffect(() => {
    return (): void => {
      stopStream();
    };
  }, []);

  return {
    isStreaming,
    transcript,
    startStream,
    stopStream,
    sendAudioChunk,
  };
}
