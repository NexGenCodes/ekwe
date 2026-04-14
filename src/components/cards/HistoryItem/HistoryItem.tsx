import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { HistoryItemProps } from './HistoryItem.types';

import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { TrashIcon } from '@/assets/icons/TrashIcon';
import { UploadIcon } from '@/assets/icons/UploadIcon';
import { getColor } from '@/constants/colors';
import { LANGUAGES } from '@/constants/languages';
import { useTheme } from '@/hooks/useTheme';
import { getRelativeTime } from '@/utils/relativeTime';

const getLanguageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

export const HistoryItem = ({
  entry,
  onPress,
  onDelete,
  style,
}: HistoryItemProps): React.ReactElement => {
  const swipeableRef = useRef<Swipeable>(null);

  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const primaryColor = getColor('primary', isDark);

  const renderRightActions = (): React.ReactElement => (
    <View className="w-20 bg-error/10 dark:bg-error-dark/20 justify-center">
      <Pressable
        testID="delete-button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete();
          swipeableRef.current?.close();
        }}
        className="flex-1 items-center justify-center p-2 active:scale-75 transition-transform"
      >
        <TrashIcon size={24} color={getColor('error', isDark)} />
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
          onPress();
        }}
        className="flex-row items-center px-4 border-b bg-card dark:bg-card-dark border-border dark:border-border-dark active:scale-95 transition-transform duration-200"
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
              className="ml-2 font-bodyMed text-[10px] text-primary dark:text-primary-dark tracking-[1.5px]"
            >
              {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
                entry.targetLang,
              )}`.toUpperCase()}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="font-body text-base text-foreground dark:text-foreground-dark"
          >
            {entry.transcript.split('\n')[0] ?? ''}
          </Text>
        </View>

        <View className="ml-3 items-end">
          <Text className="font-body text-[11px] text-muted dark:text-muted-dark mb-1">
            {getRelativeTime(entry.timestamp)}
          </Text>
          {entry.duration > 0 && (
            <View className="bg-muted/10 dark:bg-muted-dark/10 px-2 py-0.5 rounded-full border border-border/50 dark:border-border-dark/50">
              <Text className="font-bodyMed text-[9px] text-muted dark:text-muted-dark">
                {Math.round(entry.duration / 1000)}s
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
};
