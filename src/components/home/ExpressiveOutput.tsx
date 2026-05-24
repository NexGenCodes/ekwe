import * as Speech from 'expo-speech';
import { Copy, Volume2, VolumeX, Check } from 'lucide-react-native';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Share, ActivityIndicator, ScrollView } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconButton, SkeletonBox } from '../ui';

import { spacing, typography, shadows } from '@/constants/designTokens';
import { useTheme } from '@/hooks';

interface ExpressiveOutputProps {
  translation: string | null;
  isTranslating: boolean;
  copied: boolean;
  onCopy?: () => void;
  targetLang?: string;
  transliteration?: string | null;
}

export const ExpressiveOutput = React.memo(
  ({
    translation,
    isTranslating,
    copied,
    onCopy,
    targetLang,
    transliteration,
  }: ExpressiveOutputProps): React.ReactElement | null => {
    const { color } = useTheme();
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isTTSLoading, setIsTTSLoading] = useState(false);



    // Stop speech when translation changes (e.g. new dictation result)
    useEffect(() => {
      if (isSpeaking || isTTSLoading) {
        Speech.stop();
        setIsSpeaking(false);
        setIsTTSLoading(false);
      }
      // Only react to translation changes, not isSpeaking changes
    }, [translation]);

    const handleSpeakToggle = useCallback(async (): Promise<void> => {
      if (isTTSLoading) return; // Prevent spam clicking while loading

      if (isSpeaking) {
        await Speech.stop();
        setIsSpeaking(false);
        setIsTTSLoading(false);
      } else if (translation && targetLang) {
        // Ensure any existing speech is stopped before starting a new one
        await Speech.stop();
        setIsTTSLoading(true);
        Speech.speak(translation, {
          language: targetLang,
          onStart: (): void => {
            setIsTTSLoading(false);
            setIsSpeaking(true);
          },
          onDone: (): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
          },
          onError: (): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
          },
          onStopped: (): void => {
            setIsSpeaking(false);
            setIsTTSLoading(false);
          },
        });
      }
    }, [isSpeaking, isTTSLoading, translation, targetLang]);

    const containerStyle = useMemo(
      () => [styles.container, { backgroundColor: color.secondary }],
      [color.secondary],
    );

    const textStyle = useMemo(() => {
      const length = translation ? translation.length : 0;
      let fontSize = 36;
      let lineHeight = 44;

      if (length >= 150) {
        fontSize = 20;
        lineHeight = 26;
      } else if (length >= 50) {
        fontSize = 26;
        lineHeight = 32;
      }

      return [
        styles.text,
        {
          color: color.onSecondary,
          fontSize,
          lineHeight,
        },
      ];
    }, [translation, color.onSecondary]);

    const transliterationStyle = useMemo(
      () => [styles.transliteration, { color: color.onSecondary }],
      [color.onSecondary],
    );

    const listenLabelStyle = useMemo(
      () => ({
        fontFamily: 'Outfit-Medium',
        fontSize: 11,
        color: isSpeaking ? color.primary : color.onSecondary,
      }),
      [isSpeaking, color.primary, color.onSecondary],
    );

    const copyLabelStyle = useMemo(
      () => ({
        fontFamily: 'Outfit-Medium',
        fontSize: 11,
        color: copied ? color.primary : color.onSecondary,
      }),
      [copied, color.primary, color.onSecondary],
    );

    if (!translation && !isTranslating) return null;

    return (
      <View style={containerStyle}>
        {isTranslating ? (
          <View style={styles.skeletonContainer}>
            <View style={{ gap: spacing[4] }}>
              <SkeletonBox width="85%" height={44} />
              <SkeletonBox width="60%" height={44} />
              <SkeletonBox width="40%" height={44} />
            </View>
            <View style={styles.actions}>
              <View style={styles.actionGroup}>
                <SkeletonBox width={48} height={48} borderRadius={24} />
                <SkeletonBox width={40} height={12} />
              </View>
              {onCopy ? (
                <View style={styles.actionGroup}>
                  <SkeletonBox width={48} height={48} borderRadius={24} />
                  <SkeletonBox width={36} height={12} />
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <>
            <ScrollView style={{ maxHeight: 350 }} showsVerticalScrollIndicator={false}>
              <Text style={textStyle} selectable>
                {translation}
              </Text>
              {!!transliteration && (
                <Text style={transliterationStyle} selectable>
                  {transliteration}
                </Text>
              )}
            </ScrollView>
            <View style={styles.actions}>
              <View style={styles.actionGroup}>
                <IconButton
                  accessibilityLabel={
                    isSpeaking ? 'Stop speaking' : 'Listen to translation'
                  }
                  onPress={handleSpeakToggle}
                  backgroundColor={isSpeaking ? color.primary : color.surface}
                  icon={
                    isTTSLoading ? (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <ActivityIndicator size="small" color={color.muted} />
                      </Animated.View>
                    ) : isSpeaking ? (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <VolumeX
                          size={24}
                          color={color.onPrimary}
                          strokeWidth={2.5}
                        />
                      </Animated.View>
                    ) : (
                      <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                      >
                        <Volume2
                          size={24}
                          color={color.muted}
                          strokeWidth={2.5}
                        />
                      </Animated.View>
                    )
                  }
                />
                <Text style={listenLabelStyle}>
                  {isSpeaking ? 'Stop' : 'Listen'}
                </Text>
              </View>

              {onCopy ? (
                <View style={styles.actionGroup}>
                  <IconButton
                    accessibilityLabel={copied ? 'Copied' : 'Copy translation'}
                    onPress={onCopy}
                    onLongPress={async () => {
                      if (translation) {
                        await Share.share({ message: translation });
                      }
                    }}
                    backgroundColor={color.surface}
                    icon={
                      copied ? (
                        <Animated.View
                          entering={FadeIn.duration(200)}
                          exiting={FadeOut.duration(200)}
                        >
                          <Check
                            size={24}
                            color={color.primary}
                            strokeWidth={3}
                          />
                        </Animated.View>
                      ) : (
                        <Animated.View
                          entering={FadeIn.duration(200)}
                          exiting={FadeOut.duration(200)}
                        >
                          <Copy
                            size={24}
                            color={color.muted}
                            strokeWidth={2.5}
                          />
                        </Animated.View>
                      )
                    }
                  />
                  <Text style={copyLabelStyle}>
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 32,
    padding: spacing[6],
    minHeight: 240,
    ...shadows.softLg,
  },
  text: {
    fontFamily: 'Outfit-Bold',
    fontSize: 36,
    lineHeight: 44,
    flex: 1,
  },
  transliteration: {
    fontFamily: 'Outfit-Medium',
    fontSize: typography.heading3.size,
    lineHeight: 28,
    opacity: 0.95,
    marginTop: spacing[2],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[4],
    marginTop: spacing[8],
  },
  actionGroup: { alignItems: 'center', gap: spacing[2] },
  skeletonContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: spacing[2],
  },
});
