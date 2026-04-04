import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
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

export const WelcomeScreen = ({
  navigation,
}: OnboardingScreenProps<'Welcome'>): React.ReactElement => {
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

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
      ]}
    >
      <View style={[styles.inner, { paddingTop: SCREEN_HEIGHT * 0.38 }]}>
        <Animated.View style={[styles.content, animatedStyle]}>
          <EkweWordmark size={60} color={tokens.color.brand.navy} centred />
          <Text
            style={[
              styles.tagline,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
                color: tokens.color.text.secondary,
                marginTop: tokens.space[4],
              },
            ]}
          >
            Every voice understood.
          </Text>
        </Animated.View>
      </View>

      <View
        style={[
          styles.bottomArea,
          {
            paddingHorizontal: tokens.space[4],
            paddingBottom: tokens.space[6],
          },
        ]}
      >
        <EkweButton
          variant="primary"
          size="large"
          label="Get started"
          onPress={() => navigation.navigate('Microphone')}
        />
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
  },
  tagline: {
    textAlign: 'center',
  },
  bottomArea: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
  },
});
