import { Copy, Share, Loader2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { View, Text, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

import { getLanguageName } from '@/constants/languages';
import { useTheme } from '@/hooks';
import { Button } from '@/components/ui';


export interface TranslationCardProps {
  translation?: string;
  targetLang: string;
  isLoading?: boolean;
  downloadProgress?: number;
  onCopy: () => void;
  onShare: () => void;
  style?: ViewStyle;
}


export const TranslationCard = ({
  translation,
  targetLang,
  isLoading = false,
  downloadProgress,
  onCopy,
  onShare,
  style,
}: TranslationCardProps): React.ReactElement => {
  const { color } = useTheme();

  // Mount animation
  const mountOpacity = useSharedValue(0);
  const mountTranslateY = useSharedValue(8);

  // Spinner animation
  const spinRotation = useSharedValue(0);

  // Progress animation
  const progressValue = useSharedValue(0);

  useEffect(() => {
    mountOpacity.value = withTiming(1, { duration: 200 });
    mountTranslateY.value = withTiming(0, {
      duration: 200,
      easing: Easing.out(Easing.ease),
    });
  }, [mountOpacity, mountTranslateY]);

  useEffect(() => {
    if (isLoading) {
      spinRotation.value = withRepeat(
        withTiming(360, { duration: 700, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(spinRotation);
      spinRotation.value = 0;
    }
  }, [isLoading, spinRotation]);

  useEffect(() => {
    if (downloadProgress !== undefined) {
      progressValue.value = withTiming(downloadProgress, { duration: 300 });
    }
  }, [downloadProgress, progressValue]);

  const mountStyle = useAnimatedStyle(() => ({
    opacity: mountOpacity.value,
    transform: [{ translateY: mountTranslateY.value }],
  }));

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value * 100}%`,
  }));

  const renderContent = (): React.ReactNode => {
    if (isLoading) {
      return (
        <View className="min-h-[80px] items-center justify-center">
          <Animated.View style={spinStyle}>
            <Loader2 size={24} color={color.primary} />
          </Animated.View>
        </View>
      );
    }

    if (downloadProgress !== undefined && downloadProgress < 1) {
      return (
        <View className="min-h-[80px] justify-center">
          <View className="h-1 w-full overflow-hidden mb-2 bg-border rounded-full">
            <Animated.View
              style={progressStyle}
              className="h-full bg-primary rounded-full"
            />
          </View>
          <Text className="text-center font-body text-sm text-primary">
            Downloading language model… {Math.round(downloadProgress * 100)}%
          </Text>
        </View>
      );
    }

    return (
      <View>
        <Text className="mb-4 font-body text-base text-foreground leading-[22px]">
          {translation}
        </Text>
        <View className="flex-row gap-3">
          <Button
            variant="ghost"
            size="small"
            label="Copy"
            onPress={onCopy}
            leftIcon={<Copy size={14} color={color.primary} />}
          />
          <Button
            variant="ghost"
            size="small"
            label="Share"
            onPress={onShare}
            leftIcon={<Share size={14} color={color.primary} />}
          />
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={[mountStyle, style]}>
      <View className="bg-background border border-primary/30 rounded-2xl p-4">
        <Text className="text-xs mb-3 font-bodyMed text-primary tracking-widest">
          {getLanguageName(targetLang).toUpperCase()}
        </Text>
        {renderContent()}
      </View>
    </Animated.View>
  );
};
