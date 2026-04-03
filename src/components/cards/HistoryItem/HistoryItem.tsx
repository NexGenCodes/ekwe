import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { LANGUAGES } from 'src/constants/languages';
import { useTheme } from 'src/hooks/useTheme';
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
  const { tokens } = useTheme();
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (): React.ReactElement => (
    <View
      style={[
        styles.deleteAction,
        { backgroundColor: tokens.color.status.error },
      ]}
    >
      <Pressable
        onPress={() => {
          onDelete();
          swipeableRef.current?.close();
        }}
        style={styles.deleteButton}
      >
        <Text
          style={[
            styles.deleteText,
            {
              fontFamily: tokens.font.family.bodyMed,
              fontSize: tokens.font.size.label,
              color: tokens.color.text.inverse,
            },
          ]}
        >
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
        style={[
          styles.container,
          {
            backgroundColor: tokens.color.background.primary,
            borderBottomColor: tokens.color.border.default,
          },
          style,
        ]}
      >
        <View style={styles.leftContent}>
          <Text
            numberOfLines={1}
            style={[
              styles.pairText,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.label,
                color: tokens.color.text.secondary,
                letterSpacing: tokens.font.letterSpacing.label,
              },
            ]}
          >
            {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
              entry.targetLang,
            )}`.toUpperCase()}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.transcriptPreview,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
              },
            ]}
          >
            {entry.transcript.split('\n')[0] ?? ''}
          </Text>
        </View>

        <View style={styles.rightContent}>
          <Text
            style={[
              styles.timeText,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.caption,
                color: tokens.color.text.tertiary,
              },
            ]}
          >
            {getRelativeTime(entry.timestamp)}
          </Text>
        </View>
      </Pressable>
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  leftContent: {
    flex: 1,
  },
  pairText: {
    marginBottom: 2,
  },
  transcriptPreview: {
    marginTop: 2,
  },
  rightContent: {
    marginLeft: 12,
  },
  timeText: {
    textAlign: 'right',
  },
  deleteAction: {
    width: 80,
    height: 64,
  },
  deleteButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontWeight: 'bold',
  },
});
