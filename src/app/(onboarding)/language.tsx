import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { LANGUAGES, FLAG_MAP } from '@/constants/languages';
import { useTheme } from '@/hooks';
import { settingsActions, auth$ } from '@/store';

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
    if (selected.length !== 5) return;

    setSelectedLanguages(selected);
    setTargetLanguage(selected[0]);
    setOnboardingCompleted(true);

    const session = auth$.session.get();
    if (session) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: color.background }]}
    >
      <View style={styles.header}>
        <Animated.Text
          entering={FadeInDown.duration(400)}
          style={[styles.title, { color: color.foreground }]}
        >
          Choose your 5 languages
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.duration(400).delay(100)}
          style={[styles.subtitle, { color: color.muted }]}
        >
          Select exactly 5 languages to use in your studio. You can change these
          later in settings.
        </Animated.Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={FadeInUp.duration(600).delay(100)}
          style={styles.gridContainer}
        >
          {LANGUAGES.map((lang, index) => {
            const code = lang.code;
            const isSelected = selected.includes(code);

            return (
              <Animated.View
                key={code}
                entering={FadeInDown.duration(300).delay(index * 30)}
                style={{ width: '48%', marginBottom: 16 }}
              >
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => toggleLanguage(code)}
                  style={[
                    {
                      width: '100%',
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
                    {lang.englishName}
                  </Text>
                  {isSelected && (
                    <View style={styles.checkIcon}>
                      <Check size={18} color="#FFFFFF" strokeWidth={3} />
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </Animated.View>
      </ScrollView>

      <View
        style={[
          styles.bottomSection,
          { borderTopColor: color.border, backgroundColor: color.background },
        ]}
      >
        <Button
          variant="primary"
          size="large"
          label={
            selected.length === 5
              ? 'Start Translating'
              : `Select ${5 - selected.length} more`
          }
          disabled={selected.length !== 5}
          onPress={handleContinue}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 16 },
  title: {
    fontSize: 30,
    fontFamily: 'DMSerifDisplay-Regular',
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  subtitle: { fontSize: 16, fontFamily: 'Outfit-Regular' },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: 16,
    paddingBottom: 40,
  },
  checkIcon: { marginLeft: 4 },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 16,
    borderTopWidth: 1,
  },
});
