import { CommonActions } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweWordmark } from 'src/assets/icons/EkweWordmark';
import { EkweButton } from 'src/components/common/EkweButton';
import { useTheme } from 'src/hooks/useTheme';
import { OnboardingScreenProps } from 'src/navigation/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const ReadyScreen = ({
  navigation,
}: OnboardingScreenProps<'Ready'>): React.ReactElement => {
  const { tokens } = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 400 });
    translateY.value = withTiming(0, { duration: 400 });
  }, [opacity, translateY]);

  const handleFinish = (): void => {
    const onboardingStorage = createMMKV({ id: 'ekwe-onboarding' });
    onboardingStorage.set('onboardingCompleted', true);

    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      }),
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={[styles.inner, { paddingTop: SCREEN_HEIGHT * 0.33 }]}>
        <Animated.View style={[styles.content, animatedStyle]}>
          <EkweWordmark size={48} color={tokens.color.brand.navy} centred />
          <Text
            style={[
              styles.heading,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.heading,
                color: tokens.color.text.primary,
                marginTop: tokens.space[5],
              },
            ]}
          >
            Ekwe is ready.
          </Text>
          <Text
            style={[
              styles.body,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
                color: tokens.color.text.secondary,
                marginTop: tokens.space[3],
              },
            ]}
          >
            Your first translation is one tap away.
          </Text>

          <EkweButton
            variant="primary"
            size="large"
            label="Go to Ekwe"
            style={{ marginTop: tokens.space[8] }}
            onPress={handleFinish}
          />
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  heading: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
});
