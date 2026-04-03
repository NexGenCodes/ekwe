import { ViewStyle } from 'react-native';

export interface TranslationCardProps {
  translation?: string;
  targetLang: string;
  isLoading?: boolean;
  downloadProgress?: number;
  onCopy: () => void;
  onShare: () => void;
  style?: ViewStyle;
}
