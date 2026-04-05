import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { AllSetScreen } from 'src/screens/Onboarding/AllSetScreen';
import { LanguageScreen } from 'src/screens/Onboarding/LanguageScreen';
import { WelcomeScreen } from 'src/screens/Onboarding/WelcomeScreen';

export type OnboardingParamList = {
  Welcome: undefined;
  Language: undefined;
  AllSet: undefined;
};

const Stack = createNativeStackNavigator<OnboardingParamList>();

export const OnboardingNavigator = (): React.JSX.Element => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Welcome" component={WelcomeScreen} />
    <Stack.Screen name="Language" component={LanguageScreen} />
    <Stack.Screen name="AllSet" component={AllSetScreen} />
  </Stack.Navigator>
);
