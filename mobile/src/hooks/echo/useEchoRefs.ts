import { useRef, useEffect } from "react";

export interface EchoRefs {
  savedRef: React.MutableRefObject<boolean>;
  transcriptRef: React.MutableRefObject<string | null>;
  detectedLangRef: React.MutableRefObject<string | null>;
  targetLangRef: React.MutableRefObject<string>;
  sttRef: React.MutableRefObject<string | undefined>;
  durationRef: React.MutableRefObject<number>;
}

interface EchoRefState {
  transcription: string | null;
  detectedLang: string | null;
  targetLang: string;
  sttProvider?: string;
  audioDuration: number;
}

export const useEchoRefs = (state: EchoRefState): EchoRefs => {
  const savedRef = useRef(false);
  const transcriptRef = useRef(state.transcription);
  const detectedLangRef = useRef(state.detectedLang);
  const targetLangRef = useRef(state.targetLang);
  const sttRef = useRef(state.sttProvider);
  const durationRef = useRef(state.audioDuration);

  useEffect(() => {
    transcriptRef.current = state.transcription;
    detectedLangRef.current = state.detectedLang;
    targetLangRef.current = state.targetLang;
    sttRef.current = state.sttProvider;
    durationRef.current = state.audioDuration;
  }, [
    state.transcription,
    state.detectedLang,
    state.targetLang,
    state.sttProvider,
    state.audioDuration,
  ]);

  return {
    savedRef,
    transcriptRef,
    detectedLangRef,
    targetLangRef,
    sttRef,
    durationRef,
  };
};
