import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { JSX, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createMMKV } from 'react-native-mmkv';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HistoryIcon } from 'src/assets/icons/HistoryIcon';
import { HomeIcon } from 'src/assets/icons/HomeIcon';
import { SettingsIcon } from 'src/assets/icons/SettingsIcon';
import { useTheme } from 'src/hooks/useTheme';
import { linking } from 'src/navigation/linking';
import {
  RootStackParams,
  OnboardingStackParams,
  MainStackParams,
  MainTabsParams,
} from 'src/navigation/types';
import {
  HistoryScreen,
  HomeScreen,
  ResultScreen,
  SettingsScreen,
} from 'src/screens';
import {
  WelcomeScreen,
  MicrophoneScreen,
  LanguageScreen,
  ReadyScreen,
} from 'src/screens/Onboarding';

const RootStack = createNativeStackNavigator<RootStackParams>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParams>();
const MainStack = createNativeStackNavigator<MainStackParams>();
const MainTabs = createBottomTabNavigator<MainTabsParams>();

const onboardingStorage = createMMKV({ id: 'ekwe-onboarding' });

const isOnboardingComplete = (): boolean => {
  return onboardingStorage.getBoolean('onboardingCompleted') ?? false;
};

function OnboardingNavigator(): JSX.Element {
  return (
    <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
      <OnboardingStack.Screen name="Welcome" component={WelcomeScreen} />
      <OnboardingStack.Screen name="Microphone" component={MicrophoneScreen} />
      <OnboardingStack.Screen name="Language" component={LanguageScreen} />
      <OnboardingStack.Screen name="Ready" component={ReadyScreen} />
    </OnboardingStack.Navigator>
  );
}

function MainTabsNavigator(): JSX.Element {
  const { tokens } = useTheme();

  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: tokens.color.background.primary,
          borderTopWidth: 0.5,
          borderTopColor: tokens.color.border.default,
          height: 60,
        },
        tabBarActiveTintColor: tokens.color.brand.core,
        tabBarInactiveTintColor: tokens.color.text.tertiary,
        tabBarLabelStyle: {
          fontFamily: tokens.font.family.body,
          fontSize: tokens.font.size.caption,
          marginBottom: 4,
        },
        tabBarIcon: ({ color }): React.JSX.Element => {
          const size = 22;
          if (route.name === 'Home') {
            return <HomeIcon size={size} color={color} />;
          }
          if (route.name === 'History') {
            return <HistoryIcon size={size} color={color} />;
          }
          return <SettingsIcon size={size} color={color} />;
        },
      })}
    >
      <MainTabs.Screen name="Home" component={HomeScreen} />
      <MainTabs.Screen name="History" component={HistoryScreen} />
      <MainTabs.Screen name="Settings" component={SettingsScreen} />
    </MainTabs.Navigator>
  );
}

function MainNavigator(): JSX.Element {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="MainTabs" component={MainTabsNavigator} />
      <MainStack.Screen
        name="Result"
        component={ResultScreen}
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
    </MainStack.Navigator>
  );
}

export const RootNavigator = (): JSX.Element => {
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setOnboardingDone(isOnboardingComplete());
    setChecked(true);
  }, []);

  if (!checked) return <View style={{ flex: 1 }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer linking={linking}>
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            {onboardingDone ? (
              <RootStack.Screen name="Main" component={MainNavigator} />
            ) : (
              <RootStack.Screen
                name="Onboarding"
                component={OnboardingNavigator}
              />
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};
