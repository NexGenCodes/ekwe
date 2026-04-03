import { ViewStyle } from 'react-native';
import { HistoryEntry } from 'src/store/historySlice';

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: () => void;
  onDelete: () => void;
  style?: ViewStyle;
}
