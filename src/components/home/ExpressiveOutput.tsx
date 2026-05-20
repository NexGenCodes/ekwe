import * as Speech from 'expo-speech';
import { Copy, Volume2, VolumeX, Check } from 'lucide-react-native';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Share,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import { IconButton, SkeletonBox } from '../ui';

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

    // Poll Speech.isSpeakingAsync so we can sync state if speech ends naturally.
    useEffect(() => {
      if (!isSpeaking) return;
      const interval = setInterval(async () => {
        const speaking = await Speech.isSpeakingAsync();
        if (!speaking) {
          setIsSpeaking(false);
          clearInterval(interval);
        }
      }, 300);
      return () => clearInterval(interval);
    }, [isSpeaking]);

    // Stop speech when translation changes (e.g. new dictation result)
    useEffect(() => {
      if (isSpeaking || isTTSLoading) {
        Speech.stop();
        setIsSpeaking(false);
        setIsTTSLoading(false);
      }
      // Only react to translation changes, not isSpeaking changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const textStyle = useMemo(
      () => [styles.text, { color: color.onSecondary }],
      [color.onSecondary],
    );

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
            <SkeletonBox width="85%" height={44} />
            <SkeletonBox width="60%" height={44} />
            <SkeletonBox width="40%" height={44} />
          </View>
        ) : (
          <>
            <Text style={textStyle} selectable>
              {translation}
            </Text>
            {!!transliteration && (
              <Text style={transliterationStyle} selectable>
                {transliteration}
              </Text>
            )}
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
    borderRadius: 36,
    padding: 28,
    minHeight: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 32,
    elevation: 8,
  },
  text: {
    fontFamily: 'Outfit-Bold',
    fontSize: 36,
    lineHeight: 44,
    flex: 1,
  },
  transliteration: {
    fontFamily: 'Outfit-Medium',
    fontSize: 20,
    lineHeight: 28,
    opacity: 0.7,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 32,
  },
  actionGroup: { alignItems: 'center', gap: 6 },
  skeletonContainer: {
    flex: 1,
    gap: 16,
    paddingTop: 8,
  },
});
