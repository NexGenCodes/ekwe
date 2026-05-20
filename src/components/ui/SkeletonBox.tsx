import React, { useEffect } from 'react';
import {
  View,
  DimensionValue,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks';

export interface SkeletonBoxProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: object;
}

export function SkeletonBox({
  width,
  height,
  borderRadius = 12,
  style,
}: SkeletonBoxProps): React.ReactElement {
  const { color } = useTheme();
  const opacity = useSharedValue(0.1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: color.onSecondary, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function SkeletonHistoryRow(): React.ReactElement {
  return (
    <View style={styles.historyRow}>
      <SkeletonBox width={24} height={24} borderRadius={8} />
      <View style={styles.historyTextBlock}>
        <SkeletonBox width="75%" height={14} borderRadius={6} />
        <View style={{ height: 6 }} />
        <SkeletonBox width="55%" height={12} borderRadius={6} />
      </View>
      <SkeletonBox width={50} height={18} borderRadius={8} />
    </View>
  );
}

export function SkeletonTranslationPreview(): React.ReactElement {
  const { color } = useTheme();
  return (
    <View style={[styles.translationContainer, { backgroundColor: color.card }]}>
      <View style={styles.translationHeader}>
        <SkeletonBox width={100} height={14} borderRadius={6} />
        <SkeletonBox width={70} height={14} borderRadius={6} />
      </View>
      <View style={styles.transcriptionBlock}>
        <SkeletonBox width="100%" height={12} borderRadius={6} />
        <View style={{ height: 6 }} />
        <SkeletonBox width="85%" height={12} borderRadius={6} />
        <View style={{ height: 6 }} />
        <SkeletonBox width="70%" height={12} borderRadius={6} />
      </View>
      <View style={styles.translationFooter}>
        <SkeletonBox width={140} height={36} borderRadius={20} />
        <SkeletonBox width={36} height={36} borderRadius={18} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
  },
  historyTextBlock: {
    flex: 1,
  },
  translationContainer: {
    margin: 16,
    padding: 20,
    borderRadius: 20,
    gap: 16,
  },
  translationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transcriptionBlock: {
    paddingVertical: 4,
  },
  translationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
});
