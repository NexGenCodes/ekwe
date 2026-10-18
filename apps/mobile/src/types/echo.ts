export type EchoStep =
  | "PickLanguage"
  | "Preview"
  | "Transcribing"
  | "TranscribeResult"
  | "Translating"
  | "FullResult"
  | "Error";

export interface EchoProps {
  audioUri?: string;
  mimeType?: string;
  fileName?: string;
  sourceApp?: string;

  onClose?: () => void;
}

export interface UseEchoFlowResult {
  step: EchoStep;
  setStep: (step: EchoStep) => void;
  selectedLang: string;
  setSelectedLang: (lang: string) => void;
  detectedLang: string | null;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  transcription: string | null;
  translation: string | null;
  sttProvider: string | undefined;
  llmProvider: string | undefined;
  audioUri: string | undefined;
  /** M4A/AAC-LC playback copy derived from the same decode; undefined when absent. */
  playbackUri: string | undefined;
  /** The app the audio was shared from, or null when the platform didn't say. */
  sourceApp: string | null;
  isResolving: boolean;
  convertedWaveform: number[];
  convertedDurationMs: number | null;
  handleTranscribe: (
    durationSeconds: number,
    waveform: number[],
  ) => Promise<void>;
  handleTranslate: () => Promise<void>;
  cancelProcessing: () => void;
  retryOperation: () => Promise<void>;

  resolveRetryable: boolean;
  audioDuration: number;
  uploadProgress: number | null;
  error: string | null;

  autoCopied: boolean;
  onDismiss: () => void;

  autoLanguageDetect: boolean;

  isOnline: boolean;
}
