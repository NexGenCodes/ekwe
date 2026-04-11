import { ViewStyle } from 'react-native';

import { HistoryEntry } from '@/store/historySlice';

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: () => void;
  onDelete: () => void;
  style?: ViewStyle;
}
