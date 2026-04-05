import React, { useEffect } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { TranscriptCard } from 'src/components/cards/TranscriptCard';
import { TranslationCard } from 'src/components/cards/TranslationCard';
import { useTheme } from 'src/hooks/useTheme';
import { useTranslation } from 'src/hooks/useTranslation';
import { useSettingsStore } from 'src/store';

import { FloatingResultCardProps } from './FloatingResultCard.types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.6;

export const FloatingResultCard = ({
  transcript,
  sourceLang,
  targetLang,
  duration,
  sessionId,
  onDismiss,
}: FloatingResultCardProps): React.ReactElement => {
  const tokens = useTheme();
  const { translate, isTranslating, translation } = useTranslation();
  const selectedLanguages = useSettingsStore((s) => s.selectedLanguages);

  const translateY = useSharedValue(CARD_MAX_HEIGHT);
  const opacity = useSharedValue(0);

  // Slide up on mount
  useEffect(() => {
    translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
    opacity.value = withTiming(1, { duration: 200 });
  }, []);

  const dismiss = (): void => {
    translateY.value = withSpring(CARD_MAX_HEIGHT, { damping: 20 }, () =>
      runOnJS(onDismiss)(),
    );
    opacity.value = withTiming(0, { duration: 200 });
  };

  // Swipe down to dismiss
  const startY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 500) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withSpring(0, { damping: 20 });
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
    // Clipboard — Expo Clipboard in Phase 8
  };

  const handleShare = async (): Promise<void> => {
    // Share sheet — Expo Sharing in Phase 8
  };

  return (
    <View className="absolute inset-0 z-50">
      {/* Backdrop */}
      <Animated.View
        onTouchEnd={dismiss}
        className="absolute inset-0 bg-black/40"
        style={{ opacity }}
      />

      {/* Card */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          className="absolute bottom-0 left-6 right-6 bg-white dark:bg-zinc-900 rounded-3xl pb-6 overflow-hidden"
          style={[
            tokens.shadow.overlay,
            cardStyle,
            { maxHeight: CARD_MAX_HEIGHT },
          ]}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </View>

          <ScrollView className="p-4" showsVerticalScrollIndicator={false}>
            <TranscriptCard
              transcript={transcript}
              sourceLang={sourceLang}
              duration={duration}
              onCopy={handleCopy}
              onTranslate={handleTranslate}
              onShare={handleShare}
            />

            {(isTranslating || translation !== null) && (
              <View className="mt-3">
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
