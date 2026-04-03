import { ViewStyle } from 'react-native';

export interface LanguageMismatch {
  detected: string;
  suggested: string;
}

export interface TranscriptCardProps {
  transcript: string;
  isStreaming?: boolean;
  sourceLang: string;
  duration: number;
  onCopy: () => void;
  onTranslate: () => void;
  onShare: () => void;
  languageMismatch?: LanguageMismatch;
  onAcceptMismatch?: () => void;
  style?: ViewStyle;
}
