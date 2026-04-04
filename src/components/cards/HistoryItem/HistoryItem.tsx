import React, { useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { LANGUAGES } from 'src/constants/languages';
import { getRelativeTime } from 'src/utils/relativeTime';

import { HistoryItemProps } from './HistoryItem.types';

const getLanguageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

export const HistoryItem = ({
  entry,
  onPress,
  onDelete,
  style,
}: HistoryItemProps): React.ReactElement => {
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (): React.ReactElement => (
    <View className="w-20 h-16 bg-red-500">
      <Pressable
        onPress={() => {
          onDelete();
          swipeableRef.current?.close();
        }}
        className="flex-1 items-center justify-center p-2 active:opacity-60"
      >
        <Text className="font-bodyMed text-xs text-white font-bold">
          DELETE
        </Text>
      </Pressable>
    </View>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={40}
    >
      <Pressable
        onPress={onPress}
        className="h-[80px] flex-row items-center px-5 mx-4 mb-3 bg-card dark:bg-card-dark rounded-2xl border border-zinc-200/50 dark:border-zinc-800/80 active:bg-zinc-100 dark:active:bg-zinc-800/50"
        style={style}
      >
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="mb-0.5 font-bodyMed text-xs text-primary tracking-[1px]"
          >
            {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
              entry.targetLang,
            )}`.toUpperCase()}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="mt-0.5 font-body text-xs text-zinc-400 dark:text-zinc-500"
          >
            {entry.transcript.split('\n')[0] ?? ''}
          </Text>
        </View>

        <View className="ml-3">
          <Text className="text-right font-body text-xs text-zinc-400 dark:text-zinc-500">
            {getRelativeTime(entry.timestamp)}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
};
