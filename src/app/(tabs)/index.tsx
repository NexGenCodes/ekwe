import { useSelector } from '@legendapp/state/react';
import { useRouter } from 'expo-router';
import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeHeader, TranslationInterface } from '@/components/home';
import { GradientMesh } from '@/components/ui';
import { useTheme } from '@/hooks';
import { settings$ } from '@/store';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );

  React.useEffect(() => {
    if (!onboardingCompleted) {
      router.replace('/(onboarding)/language');
    }
  }, [onboardingCompleted, router]);

  const [isInputFocused, setIsInputFocused] = useState(false);

  const containerStyle = useMemo(
    () => [styles.container, { backgroundColor: color.background }],
    [color.background]
  );

  const headerBgStyle = useMemo(
    () => [
      styles.headerBackground,
      { height: insets.top, backgroundColor: color.background },
    ],
    [insets.top, color.background]
  );

  const contentContainerStyle = useMemo(
    () => [
      styles.scrollContent,
      { paddingBottom: insets.bottom + 80 },
    ],
    [insets.bottom]
  );

  if (!onboardingCompleted)
    return <View style={containerStyle} />;

  return (
    <View style={containerStyle}>
      <View style={headerBgStyle} />
      <ScrollView
        style={styles.scrollView}
        scrollEnabled={!isInputFocused}
        contentContainerStyle={contentContainerStyle}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        nestedScrollEnabled={true}
      >
        <GradientMesh />
        <View style={{ paddingTop: insets.top }}>
          <Animated.View entering={FadeInDown.duration(500)}>
            <HomeHeader />
          </Animated.View>

          <TranslationInterface 
            onInputFocusChange={setIsInputFocused}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 24,
    flexGrow: 1,
  },
});
