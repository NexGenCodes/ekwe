import { useRef, useState } from "react";

export type DictationStatus =
  | "idle"
  | "initializing"
  | "recording"
  | "preview"
  | "processing"
  | "error";

export interface UseDictationStateReturn {
  status: DictationStatus;
  statusRef: React.MutableRefObject<DictationStatus>;
  setStatus: (s: DictationStatus) => void;
  meteringData: number[];
  setMeteringData: React.Dispatch<React.SetStateAction<number[]>>;
  nativeWaveform: number[];
  setNativeWaveform: React.Dispatch<React.SetStateAction<number[]>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  maxDurationTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  sourceLangRef: React.MutableRefObject<string>;
  capturedUriRef: React.MutableRefObject<string | null>;
  capturedMeteringRef: React.MutableRefObject<number[]>;
  capturedDurationRef: React.MutableRefObject<number>;
  capturedNativeWaveformRef: React.MutableRefObject<number[]>;
  isStoppingRef: React.MutableRefObject<boolean>;
  manualStopRef: React.MutableRefObject<boolean>;
  stopDictationRef: React.MutableRefObject<() => Promise<string | null>>;
}

/**
 * useDictationState — Extracted state management for voice dictation.
 * Manages dual state refs (for immediate reads during async operations)
 * and React state (for re-renders).
 */
export function useDictationState(): UseDictationStateReturn {
  // Status state with dual ref pattern for reading during async ops
  const [status, _setStatus] = useState<DictationStatus>("idle");
  const statusRef = useRef<DictationStatus>("idle");
  const setStatus = (s: DictationStatus): void => {
    statusRef.current = s;
    _setStatus(s);
  };

  // Metering and waveform data
  const [meteringData, setMeteringData] = useState<number[]>([]);
  const [nativeWaveform, setNativeWaveform] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Captured audio metadata refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sourceLangRef = useRef<string>("auto");
  const capturedUriRef = useRef<string | null>(null);
  const capturedMeteringRef = useRef<number[]>([]);
  const capturedDurationRef = useRef<number>(0);
  const capturedNativeWaveformRef = useRef<number[]>([]);
  const isStoppingRef = useRef(false);
  const manualStopRef = useRef(false);

  // Dynamic reference holder for stopDictation callback
  const stopDictationRef = useRef<() => Promise<string | null>>(
    async () => null,
  );

  return {
    status,
    statusRef,
    setStatus,
    meteringData,
    setMeteringData,
    nativeWaveform,
    setNativeWaveform,
    error,
    setError,
    abortControllerRef,
    maxDurationTimeoutRef,
    sourceLangRef,
    capturedUriRef,
    capturedMeteringRef,
    capturedDurationRef,
    capturedNativeWaveformRef,
    isStoppingRef,
    manualStopRef,
    stopDictationRef,
  } as const;
}

