export type EchoStep =
  | "PickLanguage"
  | "Preview"
  | "Transcribing"
  | "TranscribeResult"
  | "Translating"
  | "FullResult"
  | "Error";

export interface SharedFile {
  value: string;
  type: string;
  mimeType: string;
}

export interface EchoProps {
  // IOS Share Intent Data
  value?: SharedFile[];
  type?: string;
  // Android Share Intent Data
  audioUri?: string;
  mimeType?: string;
  fileName?: string;
  sourceApp?: string;
  // Called when the user dismisses Echo (iOS share route pops the modal)
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
  sourceApp: string;
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
  /** False when the last resolution error is terminal (e.g. FILE_TOO_LARGE),
   *  so the Error step must not offer "Try Again". */
  resolveRetryable: boolean;
  audioDuration: number;
  uploadProgress: number | null;
  error: string | null;
  /** Transient "copied" signal set when the flow auto-copies the translation. */
  autoCopied: boolean;
  onDismiss: () => void;
  /** Whether the user's plan allows language auto-detection. */
  autoLanguageDetect: boolean;
}
