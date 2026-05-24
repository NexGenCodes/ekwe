import React, { useEffect } from 'react';
import { View, DimensionValue, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
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
  const shimmerProgress = useSharedValue(0);
  const layoutWidth = useSharedValue(0);

  useEffect(() => {
    shimmerProgress.value = withRepeat(
      withTiming(1, {
        duration: 1500,
        easing: Easing.bezier(0.3, 0, 0.7, 1),
      }),
      -1,
      false,
    );
  }, [shimmerProgress]);

  const animatedStyle = useAnimatedStyle(() => {
    const w = layoutWidth.value || 300;
    const translateX = interpolate(
      shimmerProgress.value,
      [0, 1],
      [-w * 0.6, w * 1.4],
    );
    return {
      transform: [{ translateX }, { skewX: '-20deg' }],
    };
  });

  return (
    <View
      onLayout={(e) => {
        layoutWidth.value = e.nativeEvent.layout.width;
      }}
      style={[
        {
          width,
          height,
          borderRadius,
          overflow: 'hidden',
          position: 'relative',
        },
        style,
      ]}
    >
      {/* Base Background */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: color.onSecondary, opacity: 0.12 },
        ]}
      />
      {/* Shimmer Sweep Overlay */}
      <Animated.View
        style={[
          styles.shimmerBar,
          { backgroundColor: color.onSecondary, opacity: 0.35 },
          animatedStyle,
        ]}
      />
    </View>
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
    <View
      style={[styles.translationContainer, { backgroundColor: color.card }]}
    >
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
  shimmerBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '45%',
  },
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
