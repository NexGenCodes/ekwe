import { Copy, Share, ChevronRight } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { EkweButton } from 'src/components/common/EkweButton';
import { LANGUAGES } from 'src/constants/languages';
import { useTheme } from 'src/hooks/useTheme';

import { TranscriptCardProps } from './TranscriptCard.types';

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
  const { tokens } = useTheme();
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
      style={[
        styles.container,
        {
          backgroundColor: tokens.color.background.primary,
          borderColor: tokens.color.border.default,
          borderRadius: tokens.radius.lg,
          padding: tokens.space[4],
          ...tokens.shadow.card,
        },
        style,
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text
          style={[
            styles.headerLabel,
            {
              fontFamily: tokens.font.family.bodyMed,
              color: tokens.color.text.tertiary,
              letterSpacing: tokens.font.letterSpacing.label,
            },
          ]}
        >
          {getLanguageName(sourceLang).toUpperCase()}
        </Text>
        <Text
          style={[
            styles.headerLabel,
            {
              fontFamily: tokens.font.family.bodyMed,
              color: tokens.color.text.tertiary,
              letterSpacing: tokens.font.letterSpacing.label,
            },
          ]}
        >
          {formatDuration(duration)}
        </Text>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {isStreaming ? (
          <View style={styles.streamingContainer}>
            <Text
              style={[
                styles.transcriptText,
                {
                  fontFamily: tokens.font.family.body,
                  fontSize: tokens.font.size.body,
                  color: tokens.color.text.primary,
                  lineHeight: tokens.font.lineHeight.body,
                },
              ]}
            >
              {transcript}
            </Text>
            <Animated.View
              style={[
                styles.cursor,
                { backgroundColor: tokens.color.brand.core },
                cursorStyle,
              ]}
            />
          </View>
        ) : (
          <Text
            style={[
              styles.transcriptText,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
                color: tokens.color.text.primary,
                lineHeight: tokens.font.lineHeight.body,
              },
            ]}
          >
            {transcript}
          </Text>
        )}
      </View>

      {/* Language Mismatch Warning */}
      {languageMismatch && (
        <Pressable
          onPress={onAcceptMismatch}
          style={[
            styles.mismatchRow,
            {
              backgroundColor: tokens.color.status.warning + '1A',
              borderRadius: tokens.radius.sm,
              padding: tokens.space[2],
            },
          ]}
        >
          <Text
            style={[
              styles.mismatchText,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.caption,
                color: tokens.color.status.warning,
              },
            ]}
          >
            Sounds like {languageMismatch.detected}, not{' '}
            {getLanguageName(sourceLang)}. Translate from{' '}
            {languageMismatch.detected}?
          </Text>
          <ChevronRight size={14} color={tokens.color.status.warning} />
        </Pressable>
      )}

      {/* Actions */}
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
        <View style={styles.flexSpacer} />
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

const styles = StyleSheet.create({
  container: {
    borderWidth: 0.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLabel: {
    fontSize: 10,
  },
  body: {
    minHeight: 80,
    marginBottom: 12,
  },
  streamingContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  transcriptText: {
    textAlign: 'left',
  },
  cursor: {
    width: 2,
    height: 16,
    marginLeft: 2,
    transform: [{ translateY: 2 }],
  },
  mismatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  mismatchText: {
    flex: 1,
    marginRight: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flexSpacer: {
    flex: 1,
  },
});
