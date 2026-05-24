import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import React, { useRef, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ViewStyle, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { MicrophoneIcon } from '@/assets/icons/MicrophoneIcon';
import { TrashIcon } from '@/assets/icons/TrashIcon';
import { UploadIcon } from '@/assets/icons/UploadIcon';
import { Card } from '@/components/ui';
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

export const HistoryItem = React.memo(
  ({
    entry,
    onPress,
    onDelete,
    style,
  }: HistoryItemProps): React.ReactElement => {
    const swipeableRef = useRef<Swipeable>(null);

    const { color } = useTheme();

    const handlePress = useCallback((): void => {
      Haptics.selectionAsync();
      onPress(entry);
    }, [entry, onPress]);

    const handleDelete = useCallback((): void => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onDelete(entry.id);
      swipeableRef.current?.close();
    }, [entry.id, onDelete]);

    const renderRightActions = useCallback(
      (): React.ReactElement => (
        <View
          style={[
            styles.rightActionContainer,
            { backgroundColor: `${color.error}33` },
          ]}
        >
          <Pressable
            testID="delete-button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleDelete}
            style={styles.deleteButton}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${entry.transcript?.split('\n')[0] || 'entry'}`}
          >
            {process.env.EXPO_OS === 'ios' ? (
              <ExpoImage
                source="sf:trash.fill"
                style={{ width: 24, height: 24 }}
                tintColor={color.error}
              />
            ) : (
              <TrashIcon size={24} color={color.error} />
            )}
          </Pressable>
        </View>
      ),
      [color.error, handleDelete],
    );

    const badgeStyle = useMemo(
      () => [
        styles.durationBadge,
        {
          backgroundColor: `${color.secondary}15`,
          borderColor: `${color.secondary}30`,
        },
      ],
      [color.secondary],
    );

    return (
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        friction={2}
        rightThreshold={40}
        containerStyle={styles.swipeableContainer}
      >
        <Card padding="none" style={[styles.itemContainer, style]}>
          <Pressable
            onPress={handlePress}
            style={styles.contentContainer}
            accessibilityRole="button"
            accessibilityLabel={`${entry.transcript?.split('\n')[0] || 'History entry'}. ${getLanguageName(entry.sourceLang)} to ${getLanguageName(entry.targetLang)}`}
          >
            <View style={styles.textContainer}>
              <View style={styles.langRow}>
                {entry.sourceApp === 'shared' ? (
                  process.env.EXPO_OS === 'ios' ? (
                    <ExpoImage
                      source="sf:square.and.arrow.up"
                      style={{ width: 12, height: 12 }}
                      tintColor={color.secondary}
                    />
                  ) : (
                    <UploadIcon size={12} color={color.secondary} />
                  )
                ) : process.env.EXPO_OS === 'ios' ? (
                  <ExpoImage
                    source="sf:mic.fill"
                    style={{ width: 12, height: 12 }}
                    tintColor={color.secondary}
                  />
                ) : (
                  <MicrophoneIcon size={12} color={color.secondary} />
                )}
                <Text
                  numberOfLines={1}
                  style={[styles.langText, { color: color.secondary }]}
                >
                  {`${getLanguageName(entry.sourceLang)} → ${getLanguageName(
                    entry.targetLang,
                  )}`.toUpperCase()}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.transcriptText, { color: color.foreground }]}
              >
                {entry.transcript?.split('\n')[0] ?? ''}
              </Text>
            </View>

            <View style={styles.metaContainer}>
              <Text style={[styles.timeText, { color: color.muted }]}>
                {getRelativeTime(entry.timestamp)}
              </Text>
              {entry.duration > 0 && (
                <View style={badgeStyle}>
                  <Text
                    style={[styles.durationText, { color: color.secondary }]}
                  >
                    {Math.round(entry.duration / 1000)}s
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        </Card>
      </Swipeable>
    );
  },
  (prev, next) =>
    prev.entry.id === next.entry.id &&
    prev.entry.timestamp === next.entry.timestamp &&
    prev.onPress === next.onPress &&
    prev.onDelete === next.onDelete &&
    prev.style === next.style,
);

const styles = StyleSheet.create({
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  rightActionContainer: { width: 80, justifyContent: 'center' },
  deleteButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  swipeableContainer: { backgroundColor: 'transparent' },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  textContainer: { flex: 1, paddingVertical: 20 },
  langRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  langText: {
    marginLeft: 8,
    fontFamily: 'Outfit-Medium',
    fontSize: 10,
    letterSpacing: 1.2,
  },
  transcriptText: {
    fontFamily: 'Outfit-Medium',
    fontSize: 17,
    letterSpacing: -0.3,
  },
  metaContainer: { marginLeft: 12, alignItems: 'flex-end' },
  timeText: { fontFamily: 'Outfit-Medium', fontSize: 11, marginBottom: 6 },
  durationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    borderWidth: 1,
  },
  durationText: { fontFamily: 'Outfit-Medium', fontSize: 10 },
});
