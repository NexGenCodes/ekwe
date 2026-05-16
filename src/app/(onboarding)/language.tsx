import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';
import { settingsActions, auth$ } from '@/store';

const POPULAR_LANGS = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'zh',
  'ja',
  'ko',
  'ar',
  'ru',
  'hi',
  'tr',
  'nl',
  'pl',
];

export default function OnboardingLanguagesScreen(): React.ReactElement {
  const router = useRouter();
  const { setSelectedLanguages, setTargetLanguage, setOnboardingCompleted } =
    settingsActions;
  const [selected, setSelected] = useState<string[]>([]);

  const { color } = useTheme();
  const brandPrimary = color.primary;
  const bgMain = color.background;
  const handleHex = color.border;

  const toggleLanguage = (code: string): void => {
    if (selected.includes(code)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelected((prev) => prev.filter((c) => c !== code));
    } else {
      if (selected.length >= 5) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelected((prev) => [...prev, code]);
    }
  };

  const handleContinue = (): void => {
    if (selected.length === 0) return;

    setSelectedLanguages(selected);
    setTargetLanguage(selected[0]); // Primary language is the first choice
    setOnboardingCompleted(true);

    // Check session synchronously from observable
    const session = auth$.session.get();
    if (session) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background">
      <View className="px-6 pt-10 pb-4">
        <Animated.Text
          entering={FadeInDown.duration(600).springify()}
          className="text-3xl font-display text-foreground dark:text-foreground tracking-tight mb-2"
        >
          What languages do you use?
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.duration(600).delay(100).springify()}
          className="text-base font-body text-muted dark:text-zinc-400"
        >
          Select up to 5 languages for your quick-switch grid. The first one you
          tap will be your primary target.
        </Animated.Text>
      </View>

      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        <Animated.View
          entering={FadeInUp.duration(800).delay(200).springify()}
          className="flex-row flex-wrap justify-between pt-4 pb-10"
        >
          {POPULAR_LANGS.map((code) => {
            const isSelected = selected.includes(code);
            const langData = LANGUAGES.find((l) => l.code === code);
            if (!langData) return null;

            return (
              <TouchableOpacity
                key={code}
                activeOpacity={0.7}
                onPress={() => toggleLanguage(code)}
                style={[
                  {
                    width: '48%',
                    aspectRatio: 2.2,
                    backgroundColor: isSelected ? brandPrimary : bgMain,
                    borderColor: isSelected ? brandPrimary : handleHex,
                    borderWidth: 2,
                    borderRadius: 20,
                    marginBottom: 16,
                    paddingHorizontal: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                  },
                ]}
              >
                <Text style={{ fontSize: 24, marginRight: 10 }}>
                  {FLAG_MAP[code] || '🌐'}
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 15,
                    fontFamily: 'Outfit-Medium',
                    color: isSelected ? '#FFFFFF' : color.foreground,
                  }}
                  numberOfLines={1}
                >
                  {langData.englishName}
                </Text>
                {isSelected && (
                  <View className="ml-1">
                    <Check size={18} color="#FFFFFF" strokeWidth={3} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </ScrollView>

      <View className="px-6 pb-12 pt-4 border-t border-border dark:border-zinc-800 bg-background dark:bg-background">
        <Button
          variant="primary"
          size="large"
          label={`Continue ${selected.length > 0 ? `(${selected.length}/5)` : ''}`}
          disabled={selected.length === 0}
          onPress={handleContinue}
        />
      </View>
    </SafeAreaView>
  );
}
