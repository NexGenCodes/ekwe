import { useSelector } from '@legendapp/state/react';
import * as Haptics from 'expo-haptics';
import { Mic, ArrowRightLeft, Copy, Volume2, Check, X, Languages } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, Keyboard, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeInUp, SlideInDown } from 'react-native-reanimated';

import { AccountAvatar } from '@/components';
import { useTheme, useTranslation, useClipboard } from '@/hooks';
import { auth$, settings$ } from '@/store';
import { HistoryService } from '@/services/HistoryService';
import { getLanguageName } from '@/constants/languages';
import { AppAlert } from '@/utils/alert';

export default function HomeScreen(): React.ReactElement {
  const { color, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const userSession = useSelector(() => auth$.session.get());

  const { translate } = useTranslation();
  const { copied, copy } = useClipboard();

  const defaultTargetLang = useSelector(() => settings$.targetLanguage.get());
  const pinnedLanguagesRaw = useSelector(() => settings$.pinnedLanguages.get());
  const pinnedLangs = pinnedLanguagesRaw?.length > 0 ? pinnedLanguagesRaw : ['en', 'es', 'fr', 'de', 'it'];

  const [sourceText, setSourceText] = useState('');
  const [translation, setTranslation] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const [sourceLang, setSourceLang] = useState<string>('en');
  const [targetLang, setTargetLang] = useState<string>(defaultTargetLang || 'es');

  const handleSwap = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setSourceText(translation || '');
    setTranslation(null);
  }, [sourceLang, targetLang, translation]);

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim()) return;
    Keyboard.dismiss();
    setIsTranslating(true);
    try {
      const result = await translate(sourceText.trim(), sourceLang, targetLang);
      if (!result.ok) throw new Error(result.error);

      const translationText = result.value.translation;
      setTranslation(translationText);

      await HistoryService.recordTranslation(
        {
          sourceLang,
          targetLang,
          transcript: sourceText.trim(),
          translation: translationText,
          duration: 0,
          sourceApp: 'ekwe-home',
          provider: 'gemini',
        },
        userSession as any,
      );
    } catch {
      AppAlert.error('Translation Failed', 'Please try again.');
    } finally {
      setIsTranslating(false);
    }
  }, [sourceText, sourceLang, targetLang, translate, userSession]);

  const handleDictate = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: Connect actual @react-native-voice/voice dictation here.
    // For now, if there's text, we simulate it not overriding, but 
    // ideally this captures voice and Appends or Replaces sourceText.
    AppAlert.info('Dictation Started', 'Voice transcription would begin here.');
  };

  const LanguageRibbon = ({
    selected,
    onSelect,
    isTarget = false
  }: {
    selected: string;
    onSelect: (l: string) => void;
    isTarget?: boolean;
  }) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-4"
      contentContainerStyle={{ gap: 8, paddingRight: 20 }}
    >
      {pinnedLangs.map((lang) => {
        const isSelected = selected === lang;
        return (
          <Pressable
            key={lang}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(lang);
              if (isTarget) setTranslation(null);
            }}
            className={`px-4 min-h-[40px] items-center justify-center rounded-full border active:scale-95 transition-all duration-200 ${isSelected
                ? 'bg-foreground dark:bg-foreground border-foreground dark:border-foreground'
                : 'bg-transparent border-border dark:border-border'
              }`}
          >
            <Text className={`font-bodyMed text-sm ${isSelected ? 'text-background dark:text-background' : 'text-foreground dark:text-foreground'
              }`}>
              {getLanguageName(lang)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View className="flex-1 bg-background dark:bg-background" style={{ paddingTop: insets.top }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Top Header */}
        <Animated.View
          entering={FadeInDown.duration(600)}
          className="flex-row items-center justify-between px-6 pt-4 pb-2 z-10"
        >
          <View className="flex-row items-center gap-x-2">
            <Languages size={24} color={color.primary} />
            <Text className="font-display text-xl text-foreground dark:text-foreground">Ekwe</Text>
          </View>
          <AccountAvatar />
        </Animated.View>

        {/* The Immersive Split Canvas */}
        <View className="flex-1 px-4 pt-2 pb-4">

          {/* Source Section (Top) */}
          <Animated.View
            entering={FadeIn.duration(800)}
            className="flex-1 bg-card dark:bg-card rounded-t-[32px] p-6 border border-border dark:border-border overflow-hidden"
          >
            <LanguageRibbon selected={sourceLang} onSelect={setSourceLang} />

            <TextInput
              className="flex-1 font-body text-3xl text-foreground dark:text-foreground text-left"
              style={{ textAlignVertical: 'top', lineHeight: 40 }}
              multiline
              placeholder="Type to translate..."
              placeholderTextColor={color.muted}
              value={sourceText}
              onChangeText={(t) => {
                setSourceText(t);
                setTranslation(null);
              }}
              selectionColor={color.primary}
            />

            <View className="flex-row justify-between items-end mt-2">
              {sourceText.length > 0 ? (
                <Animated.View entering={FadeIn}>
                  <Pressable
                    onPress={() => {
                      setSourceText('');
                      setTranslation(null);
                    }}
                    className="w-12 h-12 items-center justify-center rounded-full bg-border/50 dark:bg-border/50 active:scale-95"
                    hitSlop={8}
                  >
                    <X size={20} color={color.foreground} />
                  </Pressable>
                </Animated.View>
              ) : <View className="w-12 h-12" />}

              {sourceText.length > 0 && (
                <Animated.View entering={FadeInUp.springify()}>
                  <Pressable
                    onPress={handleTranslate}
                    className="px-6 min-h-[48px] rounded-full bg-secondary items-center justify-center active:scale-95 shadow-sm"
                  >
                    <Text className="font-bodyMed text-base text-white">Translate</Text>
                  </Pressable>
                </Animated.View>
              )}
            </View>
          </Animated.View>

          {/* SWAP DIVIDER */}
          <View className="z-20 items-center justify-center" style={{ height: 0 }}>
            <Pressable
              onPress={handleSwap}
              className="w-14 h-14 rounded-full bg-foreground dark:bg-foreground items-center justify-center active:scale-90 shadow-lg border-[6px] border-background dark:border-background absolute"
              style={{ top: -28 }}
              hitSlop={12}
            >
              <ArrowRightLeft size={20} color={color.background} />
            </Pressable>
          </View>

          {/* Target Section (Bottom) */}
          <Animated.View
            entering={SlideInDown.duration(800).springify()}
            className="flex-1 bg-card dark:bg-card rounded-b-[32px] p-6 border-b border-x border-border dark:border-border"
            style={{ borderTopWidth: 0 }}
          >
            <View className="h-4" /> {/* Spacer for the swap button overlap */}

            <LanguageRibbon selected={targetLang} onSelect={setTargetLang} isTarget />

            <View className="flex-1 justify-start pt-2">
              {isTranslating ? (
                <Animated.View entering={FadeIn} className="flex-row items-center gap-x-3 mt-2">
                  <View className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
                  <View className="w-3 h-3 rounded-full bg-secondary animate-pulse" style={{ animationDelay: '150ms' } as any} />
                  <View className="w-3 h-3 rounded-full bg-secondary animate-pulse" style={{ animationDelay: '300ms' } as any} />
                </Animated.View>
              ) : translation ? (
                <Animated.View entering={FadeInUp.springify()} className="flex-1">
                  <Text className="font-body text-3xl text-foreground dark:text-foreground" style={{ lineHeight: 40 }}>
                    {translation}
                  </Text>
                </Animated.View>
              ) : (
                <Text className="font-body text-3xl text-muted/40 dark:text-muted/40 mt-2" style={{ lineHeight: 40 }}>
                  Translation
                </Text>
              )}
            </View>

            {translation && !isTranslating && (
              <Animated.View
                entering={FadeIn.delay(200)}
                className="flex-row justify-end mt-4 gap-x-3"
              >
                <Pressable
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    // placeholder for TTS
                  }}
                  className="w-12 h-12 rounded-full bg-background dark:bg-background items-center justify-center active:scale-95 shadow-sm border border-border dark:border-border"
                  hitSlop={8}
                >
                  <Volume2 size={20} color={color.foreground} />
                </Pressable>
                <Pressable
                  onPress={async () => await copy(translation)}
                  className="w-12 h-12 rounded-full bg-background dark:bg-background items-center justify-center active:scale-95 shadow-sm border border-border dark:border-border"
                  hitSlop={8}
                >
                  {copied ? (
                    <Check size={20} color={color.success} />
                  ) : (
                    <Copy size={20} color={color.foreground} />
                  )}
                </Pressable>
              </Animated.View>
            )}
          </Animated.View>

        </View>

        {/* BOTTOM ACTION DOCK (Dictation) */}
        <Animated.View
          entering={FadeInUp.delay(300).springify()}
          className="items-center w-full z-30"
          style={{ paddingBottom: Math.max(insets.bottom, 24), paddingTop: 8 }}
        >
          <Pressable
            onPress={handleDictate}
            className="w-20 h-20 rounded-full bg-primary dark:bg-primary items-center justify-center active:scale-90 shadow-xl"
            style={{
              elevation: 10,
              shadowColor: color.primary,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16
            }}
          >
            <Mic size={36} color={isDark ? '#0A1F30' : '#FFFFFF'} />
          </Pressable>
          <Text className="font-bodyMed text-xs text-muted dark:text-muted mt-3 tracking-widest uppercase">
            Dictate
          </Text>
        </Animated.View>

      </KeyboardAvoidingView>
    </View>
  );
}
