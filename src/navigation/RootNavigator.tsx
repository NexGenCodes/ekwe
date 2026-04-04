import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import React, { JSX } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HistoryIcon } from 'src/assets/icons/HistoryIcon';
import { HomeIcon } from 'src/assets/icons/HomeIcon';
import { SettingsIcon } from 'src/assets/icons/SettingsIcon';
import { getColor } from 'src/constants/theme';
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
  FeatureOneScreen,
  FeatureTwoScreen,
  LanguageScreen,
  AllSetScreen,
} from 'src/screens/Onboarding';

const RootStack = createNativeStackNavigator<RootStackParams>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParams>();
const MainStack = createNativeStackNavigator<MainStackParams>();
const MainTabs = createBottomTabNavigator<MainTabsParams>();

function OnboardingNavigator(): JSX.Element {
  return (
    <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
      <OnboardingStack.Screen name="FeatureOne" component={FeatureOneScreen} />
      <OnboardingStack.Screen name="FeatureTwo" component={FeatureTwoScreen} />
      <OnboardingStack.Screen name="Language" component={LanguageScreen} />
      <OnboardingStack.Screen name="AllSet" component={AllSetScreen} />
    </OnboardingStack.Navigator>
  );
}

function MainTabsNavigator(): JSX.Element {
  const { colorScheme } = useColorScheme();

  const isDark = colorScheme === 'dark';

  const bgColor = getColor('background', isDark);
  const borderColor = getColor('border', isDark);
  const activeColor = getColor('primaryAccent', isDark);
  const inactiveColor = getColor('muted', isDark);

  return (
    <MainTabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: bgColor,
          borderTopWidth: 0.5,
          borderTopColor: borderColor,
          height: 60,
        },
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarLabelStyle: {
          fontFamily: 'Outfit-Regular',
          fontSize: 12,
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
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaProvider>
        <NavigationContainer linking={linking}>
          <RootStack.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName="Welcome"
          >
            <RootStack.Screen name="Welcome" component={WelcomeScreen} />
            <RootStack.Screen
              name="Onboarding"
              component={OnboardingNavigator}
            />
            <RootStack.Screen name="Main" component={MainNavigator} />
          </RootStack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};
