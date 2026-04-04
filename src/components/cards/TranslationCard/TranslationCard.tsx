import { Copy, Share, Loader2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { EkweButton } from 'src/components/common/EkweButton';
import { LANGUAGES } from 'src/constants/languages';

import { TranslationCardProps } from './TranslationCard.types';

const getLanguageName = (code: string): string =>
  LANGUAGES.find((l) => l.code === code)?.englishName ?? code;

export const TranslationCard = ({
  translation,
  targetLang,
  isLoading = false,
  downloadProgress,
  onCopy,
  onShare,
  style,
}: TranslationCardProps): React.ReactElement => {
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
            <Loader2 size={24} color="#1A7EC8" />
          </Animated.View>
        </View>
      );
    }

    if (downloadProgress !== undefined && downloadProgress < 1) {
      return (
        <View className="min-h-[80px] justify-center">
          <View className="h-1 w-full overflow-hidden mb-2 bg-zinc-200 dark:bg-zinc-800 rounded-full">
            <Animated.View
              style={progressStyle}
              className="h-full bg-primary rounded-full"
            />
          </View>
          <Text className="text-center font-body text-xs text-primary">
            Downloading language model… {Math.round(downloadProgress * 100)}%
          </Text>
        </View>
      );
    }

    return (
      <View>
        <Text className="mb-4 font-body text-base text-zinc-950 dark:text-zinc-50 leading-[22px]">
          {translation}
        </Text>
        <View className="flex-row gap-3">
          <EkweButton
            variant="ghost"
            size="small"
            label="Copy"
            onPress={onCopy}
            leftIcon={<Copy size={14} color="#1A7EC8" />}
          />
          <EkweButton
            variant="ghost"
            size="small"
            label="Share"
            onPress={onShare}
            leftIcon={<Share size={14} color="#1A7EC8" />}
          />
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={[mountStyle, style]}>
      <View className="bg-background dark:bg-background-dark border-[0.5px] border-primary/30 rounded-2xl p-4">
        <Text className="text-[10px] mb-3 font-bodyMed text-primary tracking-[1px]">
          {getLanguageName(targetLang).toUpperCase()}
        </Text>
        {renderContent()}
      </View>
    </Animated.View>
  );
};
