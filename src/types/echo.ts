export type EchoStep =
  | 'PickLanguage'
  | 'Config'
  | 'Transcribing'
  | 'TranscribeResult'
  | 'Translating'
  | 'FullResult'
  | 'Error';

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
  themePreference: 'light' | 'dark' | 'system' | null;
  handleTranscribe: (
    durationSeconds: number,
    waveform: number[],
  ) => Promise<void>;
  handleTranslate: () => Promise<void>;
  audioDuration: number;
  error: string | null;
  onDismiss: () => void;
}
