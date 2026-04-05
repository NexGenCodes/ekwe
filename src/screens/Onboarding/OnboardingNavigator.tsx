import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { LanguageScreen } from 'src/screens/Onboarding/LanguageScreen';
import { ReadyScreen } from 'src/screens/Onboarding/ReadyScreen';
import { WelcomeScreen } from 'src/screens/Onboarding/WelcomeScreen';

export type OnboardingParamList = {
  Welcome: undefined;
  Language: undefined;
  Ready: undefined;
};

const Stack = createNativeStackNavigator<OnboardingParamList>();

export const OnboardingNavigator = (): React.JSX.Element => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Welcome" component={WelcomeScreen} />
    <Stack.Screen name="Language" component={LanguageScreen} />
    <Stack.Screen name="Ready" component={ReadyScreen} />
  </Stack.Navigator>
);
