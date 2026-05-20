import { useSelector } from '@legendapp/state/react';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { Languages } from 'lucide-react-native';
import React, { useCallback, useState, useEffect } from 'react';
import { View, ScrollView, RefreshControl } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HomeHeader,
  ExpressiveInput,
  ExpressiveOutput,
} from '@/components/home';
import { EmptyState, IconContainer, GradientMesh } from '@/components/ui';
import {
  useTheme,
  useTranslation,
  useClipboard,
  useVoiceDictation,
} from '@/hooks';
import { settings$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  useEffect(() => {
    if (!onboardingCompleted) {
      router.replace('/(onboarding)/language');
    }
  }, [onboardingCompleted, router]);

  const {
    sourceText,
    setSourceText,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    translation,
    setTranslation,
    transliteration,
    setTransliteration,
    isTranslating,
    handleTranslate,
    handleClear,
    handleSwap,
  } = useTranslation();
  const { copied, copy } = useClipboard();

  const {
    status: dictationStatus,
    amplitude,
    elapsedMs,
    maxDurationMs,
    error: dictationError,
    capturedUri,
    startDictation,
    stopDictation,
    confirmDictation,
    cancelDictation,
  } = useVoiceDictation();

  const handleDictate = useCallback(async (): Promise<void> => {
    await startDictation(sourceLang);
  }, [startDictation, sourceLang]);

  // Show dictation errors via alert (clears automatically after dismiss)
  useEffect(() => {
    if (dictationError) {
      AppAlert.error('Voice Input', dictationError);
    }
  }, [dictationError]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    await handleClear();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  }, [handleClear]);

  const handleInputChange = useCallback(
    (t: string) => {
      setSourceText(t);
      if (translation) setTranslation(null);
    },
    [translation, setSourceText, setTranslation],
  );

  const handleConfirmDictation = useCallback(async () => {
    const transcript = await confirmDictation(sourceLang);
    if (transcript) {
      setSourceText(transcript);
      setTranslation(null);
      setTransliteration(null);
    }
  }, [
    confirmDictation,
    sourceLang,
    setSourceText,
    setTranslation,
    setTransliteration,
  ]);

  const handleSourceChange = useCallback(
    (lang: string) => {
      setSourceLang(lang);
      if (translation) {
        setTranslation(null);
        setTransliteration(null);
      }
    },
    [translation, setSourceLang, setTranslation, setTransliteration],
  );

  const handleTargetChange = useCallback(
    (lang: string) => {
      setTargetLang(lang);
      if (translation) {
        setTranslation(null);
        setTransliteration(null);
      }
    },
    [translation, setTargetLang, setTranslation, setTransliteration],
  );

  const handleCopy = useCallback(async () => {
    if (translation) {
      await copy(translation);
    }
  }, [translation, copy]);

  if (!onboardingCompleted)
    return <View style={{ flex: 1, backgroundColor: color.background }} />;

  return (
    <View style={{ flex: 1, backgroundColor: color.background }}>
      {/* Safe Area status bar mask to tuck content underneath on scroll */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: color.background,
          zIndex: 10,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 20,
          gap: 24,
          flexGrow: 1,
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={color.onPrimary}
            colors={[color.secondary]}
          />
        }
      >
        <GradientMesh />
        <View style={{ paddingTop: insets.top }}>
          <Animated.View entering={FadeInDown.duration(500)}>
            <HomeHeader />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(450)}>
            <ExpressiveInput
              value={sourceText}
              onChangeText={handleInputChange}
              onClear={handleClear}
              onMicPress={handleDictate}
              onTranslate={handleTranslate}
              isTranslating={isTranslating}
              dictationStatus={dictationStatus}
              amplitude={amplitude}
              elapsedMs={elapsedMs}
              maxDurationMs={maxDurationMs}
              onStop={stopDictation}
              onConfirm={handleConfirmDictation}
              capturedUri={capturedUri}
              onCancel={cancelDictation}
              sourceLang={sourceLang}
              targetLang={targetLang}
              onSwap={handleSwap}
              onSourceChange={handleSourceChange}
              onTargetChange={handleTargetChange}
            />
          </Animated.View>

          {translation || isTranslating ? (
            <Animated.View
              entering={FadeInUp.duration(300)}
              style={{ marginTop: 24 }}
            >
              <ExpressiveOutput
                translation={translation}
                transliteration={transliteration}
                isTranslating={isTranslating}
                copied={copied}
                onCopy={translation ? handleCopy : undefined}
                targetLang={targetLang}
              />
            </Animated.View>
          ) : (
            <Animated.View
              entering={FadeInUp.delay(300).duration(400)}
              style={{ marginTop: 24 }}
            >
              <EmptyState
                icon={
                  <IconContainer
                    size="xl"
                    variant="custom"
                    backgroundColor={color.surface}
                    style={{ marginBottom: 8 }}
                  >
                    {process.env.EXPO_OS === 'ios' ? (
                      <ExpoImage
                        source="sf:character.bubble.fill"
                        style={{ width: 32, height: 32 }}
                        tintColor={color.muted}
                      />
                    ) : (
                      <Languages
                        size={32}
                        color={color.muted}
                        strokeWidth={2}
                      />
                    )}
                  </IconContainer>
                }
                title="Ready to Translate"
                subtitle="Type or dictate to get started"
              />
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
