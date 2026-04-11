import { Copy, Share, ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React, { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';

import { TranscriptCardProps } from './TranscriptCard.types';

import { EkweButton } from '@/components/common/EkweButton';
import { getColor } from '@/constants/colors';
import { LANGUAGES } from '@/constants/languages';

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const getLanguageName = (code: string): string => {
  return LANGUAGES.find((l) => l.code === code)?.englishName ?? code;
};

export const TranscriptCard = ({
  transcript,
  isStreaming = false,
  sourceLang,
  duration,
  onCopy,
  onTranslate,
  onShare,
  languageMismatch,
  onAcceptMismatch,
  style,
}: TranscriptCardProps): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const cursorOpacity = useSharedValue(1);

  useEffect(() => {
    if (isStreaming) {
      cursorOpacity.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 500 }),
          withTiming(1, { duration: 500 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(cursorOpacity);
      cursorOpacity.value = 1;
    }
  }, [isStreaming, cursorOpacity]);

  const cursorStyle = useAnimatedStyle(() => ({
    opacity: cursorOpacity.value,
  }));

  return (
    <View
      className="bg-background border border-border rounded-2xl p-4 shadow-sm"
      style={style}
    >
      {/* Header */}
      <View className="flex-row justify-between mb-3">
        <Text className="font-bodyMed text-xs text-muted tracking-widest">
          {getLanguageName(sourceLang).toUpperCase()}
        </Text>
        <Text className="font-bodyMed text-xs text-muted tracking-widest">
          {formatDuration(duration)}
        </Text>
      </View>

      {/* Body */}
      <View className="min-h-[80px] mb-3">
        {isStreaming ? (
          <View className="flex-row flex-wrap items-baseline">
            <Text className="font-body text-base text-foreground leading-[22px] text-left">
              {transcript}
            </Text>
            <Animated.View
              className="w-0.5 h-4 ml-0.5 bg-primary rounded-full translate-y-0.5"
              style={cursorStyle}
            />
          </View>
        ) : (
          <Text className="font-body text-base text-foreground leading-[22px] text-left">
            {transcript}
          </Text>
        )}
      </View>

      {/* Language Mismatch Warning */}
      {languageMismatch && (
        <Pressable
          onPress={onAcceptMismatch}
          className="flex-row items-center mb-3 bg-warning/10 rounded-xl p-3 active:opacity-60"
        >
          <Text className="flex-1 mr-2 font-body text-sm text-warning">
            Sounds like {languageMismatch.detected}, not{' '}
            {getLanguageName(sourceLang)}. Translate from{' '}
            {languageMismatch.detected}?
          </Text>
          <ChevronRight size={14} color={getColor('warning', isDark)} />
        </Pressable>
      )}

      {/* Actions */}
      <View className="flex-row items-center gap-3">
        <EkweButton
          variant="ghost"
          size="small"
          label="Copy"
          onPress={onCopy}
          leftIcon={<Copy size={14} color={getColor('primary', isDark)} />}
        />
        <EkweButton
          variant="ghost"
          size="small"
          label="Share"
          onPress={onShare}
          leftIcon={<Share size={14} color={getColor('primary', isDark)} />}
        />
        <View className="flex-1" />
        <EkweButton
          variant="secondary"
          size="small"
          label="Translate"
          onPress={onTranslate}
        />
      </View>
    </View>
  );
};
