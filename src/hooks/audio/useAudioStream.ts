import { useEffect, useRef, useState } from "react";
import { useSelector } from "@legendapp/state/react";
import { auth$ } from "@/store";

export interface StreamResult {
  text: string;
  isFinal: boolean;
}

export function useAudioStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const sessionToken = useSelector(() => auth$.session.get()?.access_token);

  const startStream = async (sourceLang: string = "auto") => {
    // In production, this comes from environment config
    const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || "http://localhost:8787";
    const wsUrl = WORKER_URL.replace("http", "ws") + "/transcribe/stream";
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsStreaming(true);
      // Send initial configuration
      ws.send(JSON.stringify({
        type: "config",
        token: sessionToken,
        sourceLang
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "transcript") {
          setTranscript(data.text);
          if (data.isFinal) {
            // handle final state if necessary
          }
        }
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    ws.onclose = () => {
      setIsStreaming(false);
    };

    ws.onerror = (err) => {
      console.error("WS error", err);
      setIsStreaming(false);
    };
  };

  const sendAudioChunk = (base64Chunk: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "audio", data: base64Chunk }));
    }
  };

  const stopStream = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsStreaming(false);
  };

  useEffect(() => {
    return () => {
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
