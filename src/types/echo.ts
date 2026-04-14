import { SharedAudioPlayer } from '@/hooks/useSharedAudioPlayer';

export type EchoStep = 'PickLanguage' | 'Config' | 'Processing' | 'Result';

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
  transcription: string | null;
  translation: string | null;
  activeTab: 'Translation' | 'Transcription';
  setActiveTab: (tab: 'Translation' | 'Transcription') => void;
  audioUri: string | undefined;
  sourceApp: string;
  player: SharedAudioPlayer;
  isResolving: boolean;
  themePreference: 'light' | 'dark' | 'system' | null;
  handleProcess: () => Promise<void>;
  handleCopy: () => Promise<void>;
  onDismiss: () => void;
}
