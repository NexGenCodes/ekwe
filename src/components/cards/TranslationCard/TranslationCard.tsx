import { Copy, Share, Loader2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
import { useTheme } from 'src/hooks/useTheme';

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
  const { tokens } = useTheme();

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
        <View style={styles.loadingState}>
          <Animated.View style={spinStyle}>
            <Loader2 size={24} color={tokens.color.brand.core} />
          </Animated.View>
        </View>
      );
    }

    if (downloadProgress !== undefined && downloadProgress < 1) {
      return (
        <View style={styles.downloadState}>
          <View
            style={[
              styles.progressContainer,
              {
                backgroundColor: tokens.color.border.default,
                borderRadius: tokens.radius.full,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.progressBar,
                {
                  backgroundColor: tokens.color.brand.core,
                  borderRadius: tokens.radius.full,
                },
                progressStyle,
              ]}
            />
          </View>
          <Text
            style={[
              styles.downloadLabel,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.caption,
                color: tokens.color.brand.core,
              },
            ]}
          >
            Downloading language model… {Math.round(downloadProgress * 100)}%
          </Text>
        </View>
      );
    }

    return (
      <View>
        <Text
          style={[
            styles.translationText,
            {
              fontFamily: tokens.font.family.body,
              fontSize: tokens.font.size.body,
              color: tokens.color.text.primary,
              lineHeight: tokens.font.lineHeight.body,
            },
          ]}
        >
          {translation}
        </Text>
        <View style={styles.actions}>
          <EkweButton
            variant="ghost"
            size="small"
            label="Copy"
            onPress={onCopy}
            leftIcon={<Copy size={14} color={tokens.color.brand.core} />}
          />
          <EkweButton
            variant="ghost"
            size="small"
            label="Share"
            onPress={onShare}
            leftIcon={<Share size={14} color={tokens.color.brand.core} />}
          />
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={[mountStyle, style]}>
      <View
        style={[
          styles.container,
          {
            backgroundColor: tokens.color.background.primary,
            borderColor: tokens.color.brand.core + '4D',
            borderRadius: tokens.radius.lg,
            padding: tokens.space[4],
          },
        ]}
      >
        <Text
          style={[
            styles.headerLabel,
            {
              fontFamily: tokens.font.family.bodyMed,
              color: tokens.color.brand.core,
              letterSpacing: tokens.font.letterSpacing.label,
            },
          ]}
        >
          {getLanguageName(targetLang).toUpperCase()}
        </Text>
        {renderContent()}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 0.5,
  },
  headerLabel: {
    fontSize: 10,
    marginBottom: 12,
  },
  loadingState: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadState: {
    minHeight: 80,
    justifyContent: 'center',
  },
  progressContainer: {
    height: 4,
    width: '100%',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    width: 0,
  },
  downloadLabel: {
    textAlign: 'center',
  },
  translationText: {
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
});
