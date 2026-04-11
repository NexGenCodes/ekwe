import * as Clipboard from 'expo-clipboard';
import React, { useEffect } from 'react';
import { Dimensions, ScrollView, View, Alert, Share } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

import { FloatingResultCardProps } from './FloatingResultCard.types';

import { TranscriptCard } from '@/components/cards/TranscriptCard';
import { TranslationCard } from '@/components/cards/TranslationCard';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.65;

export const FloatingResultCard = ({
  transcript,
  sourceLang,
  targetLang,
  duration,
  sessionId,
  onDismiss,
}: FloatingResultCardProps): React.ReactElement => {
  const { translate, isTranslating, translation } = useTranslation();
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);

  const translateY = useSharedValue(SCREEN_HEIGHT);
  const opacity = useSharedValue(0);

  // Slide up on mount
  useEffect(() => {
    translateY.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, { duration: 250 });
  }, []);

  const dismiss = (): void => {
    translateY.value = withTiming(
      SCREEN_HEIGHT,
      {
        duration: 250,
        easing: Easing.in(Easing.cubic),
      },
      () => runOnJS(onDismiss)(),
    );
    opacity.value = withTiming(0, { duration: 200 });
  };

  // Swipe down to dismiss
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 600) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withTiming(0, {
          duration: 200,
          easing: Easing.out(Easing.cubic),
        });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const handleTranslate = async (): Promise<void> => {
    const lang = targetLang ?? selectedLanguages[0] ?? 'en';
    await translate(transcript, sourceLang, lang, sessionId);
  };

  const handleCopy = async (): Promise<void> => {
    if (transcript) {
      await Clipboard.setStringAsync(transcript);
      Alert.alert('Copied', 'Transcript copied to clipboard');
    }
  };

  const handleShare = async (): Promise<void> => {
    if (transcript) {
      try {
        await Share.share({
          message: translation
            ? `Ekwe Translation:\n${transcript}\n\nTranslated (${targetLang}):\n${translation}`
            : `Ekwe Transcript:\n${transcript}`,
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error sharing', error);
      }
    }
  };

  return (
    <View className="absolute inset-0 z-50">
      {/* Backdrop */}
      <Animated.View
        onTouchEnd={dismiss}
        className="absolute inset-0 bg-black/60"
        style={{ opacity }}
      />

      {/* Card Wrapper for Gesture */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          className="absolute bottom-0 left-4 right-4 bg-background dark:bg-card rounded-t-[32px] rounded-b-[24px] pb-8 overflow-hidden shadow-2xl mb-4"
          style={[cardStyle, { maxHeight: CARD_MAX_HEIGHT }]}
        >
          {/* Drag handle */}
          <View className="items-center py-4">
            <View className="w-12 h-1.5 rounded-full bg-border" />
          </View>

          <ScrollView
            className="px-4"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            <TranscriptCard
              transcript={transcript}
              sourceLang={sourceLang}
              duration={duration}
              onCopy={handleCopy}
              onTranslate={handleTranslate}
              onShare={handleShare}
            />

            {(isTranslating || translation !== null) && (
              <View className="mt-4">
                <TranslationCard
                  translation={translation ?? undefined}
                  targetLang={targetLang ?? selectedLanguages[0] ?? 'en'}
                  isLoading={isTranslating}
                  onCopy={handleCopy}
                  onShare={handleShare}
                />
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};
