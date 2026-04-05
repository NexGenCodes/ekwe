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
    <View className="w-20 bg-error">
      <Pressable
        onPress={() => {
          onDelete();
          swipeableRef.current?.close();
        }}
        className="flex-1 items-center justify-center p-2 active:opacity-60"
      >
        <Text className="font-bodyMed text-sm text-white font-bold">
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
        className="flex-row items-center px-5 mx-4 mb-3 bg-card rounded-2xl border border-border active:bg-zinc-100 dark:active:bg-zinc-800/50"
        style={style}
      >
        <View className="flex-1 py-4">
          <Text
            numberOfLines={1}
            className="mb-1 font-bodyMed text-sm text-primary tracking-[1px]"
          >
            {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
              entry.targetLang,
            )}`.toUpperCase()}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="font-body text-base text-muted"
          >
            {entry.transcript.split('\n')[0] ?? ''}
          </Text>
        </View>

        <View className="ml-3">
          <Text className="text-right font-body text-sm text-muted">
            {getRelativeTime(entry.timestamp)}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
};
