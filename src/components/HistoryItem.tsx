import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { View, Text, Pressable, ViewStyle } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { TrashIcon } from '@/assets/icons/TrashIcon';
import { UploadIcon } from '@/assets/icons/UploadIcon';
import { getLanguageName } from '@/constants/languages';
import { useTheme } from '@/hooks';
import { HistoryEntry } from '@/store';
import { getRelativeTime } from '@/utils/relativeTime';

export interface HistoryItemProps {
  entry: HistoryEntry;
  onPress: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  style?: ViewStyle;
}

export const HistoryItem = React.memo(({
  entry,
  onPress,
  onDelete,
  style,
}: HistoryItemProps): React.ReactElement => {
  const swipeableRef = useRef<Swipeable>(null);

  const { color } = useTheme();
  const primaryColor = color.primary;

  const renderRightActions = (): React.ReactElement => (
    <View className="w-20 bg-error/10 dark:bg-error/20 justify-center">
      <Pressable
        testID="delete-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete(entry.id);
          swipeableRef.current?.close();
        }}
        className="flex-1 items-center justify-center p-2 active:scale-75 transition-transform"
      >
        <TrashIcon size={24} color={color.error} />
      </Pressable>
    </View>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={40}
      containerStyle={{ backgroundColor: 'transparent' }}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          onPress(entry);
        }}
        className="flex-row items-center px-4 border-b bg-card dark:bg-card border-border dark:border-border active:scale-95 transition-transform duration-200"
        style={style}
      >
        <View className="flex-1 py-4">
          <View className="flex-row items-center mb-1">
            {entry.sourceApp === 'shared' ? (
              <UploadIcon size={12} color={primaryColor} />
            ) : (
              <MicrophoneIcon size={12} color={primaryColor} />
            )}
            <Text
              numberOfLines={1}
              className="ml-2 font-bodyMed text-[10px] text-primary dark:text-primary tracking-[1.5px]"
            >
              {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
                entry.targetLang,
              )}`.toUpperCase()}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="font-body text-base text-foreground dark:text-foreground"
          >
            {entry.transcript?.split('\n')[0] ?? ''}
          </Text>
        </View>

        <View className="ml-3 items-end">
          <Text className="font-body text-[11px] text-muted dark:text-muted mb-1">
            {getRelativeTime(entry.timestamp)}
          </Text>
          {entry.duration > 0 && (
            <View className="bg-muted/10 dark:bg-muted/10 px-2 py-0.5 rounded-full border border-border/50 dark:border-border/50">
              <Text className="font-bodyMed text-[9px] text-muted dark:text-muted">
                {Math.round(entry.duration / 1000)}s
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}, (prev, next) =>
  prev.entry.id === next.entry.id &&
  prev.entry.timestamp === next.entry.timestamp &&
  prev.onPress === next.onPress &&
  prev.onDelete === next.onDelete,
);
