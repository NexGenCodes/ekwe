import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ShareIntentProvider } from 'expo-share-intent';
import { useColorScheme } from 'nativewind';
import { useMMKVString } from 'react-native-mmkv';
import { HistoryIcon } from 'src/assets/icons/HistoryIcon';
import { HomeIcon } from 'src/assets/icons/HomeIcon';
import { SettingsIcon } from 'src/assets/icons/SettingsIcon';
import { getColor } from 'src/constants/colors';
import { useShareIntentHandler } from 'src/hooks/useShareIntentHandler';
import { linking } from 'src/navigation/linking';
import { RootStackParams, TabParamList } from 'src/navigation/types';
import { HistoryScreen } from 'src/screens/History/HistoryScreen';
import { HomeScreen } from 'src/screens/Home/HomeScreen';
import { OnboardingNavigator } from 'src/screens/Onboarding/OnboardingNavigator';
import { ResultScreen } from 'src/screens/Result/ResultScreen';
import { SettingsScreen } from 'src/screens/Settings/SettingsScreen';
import { TranslateScreen } from 'src/screens/Translate/TranslateScreen';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_BAR_HEIGHT = 64;

const TabNavigator = (): React.JSX.Element => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Listen for incoming share intents
  useShareIntentHandler();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: getColor('background', isDark),
          borderTopWidth: 0.5,
          borderTopColor: getColor('border', isDark),
          height: TAB_BAR_HEIGHT,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarActiveTintColor: getColor('primary', isDark),
        tabBarInactiveTintColor: getColor('muted', isDark),
        tabBarLabelStyle: {
          fontFamily: 'Outfit-Regular',
          fontSize: 12,
          marginTop: 2,
        },
        tabBarIcon: ({ color, size }): React.JSX.Element => {
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
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

export const RootNavigator = (): React.JSX.Element => {
  const [onboardingDone] = useMMKVString('onboarding_complete');

  return (
    <ShareIntentProvider>
      <NavigationContainer linking={linking}>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={onboardingDone === 'true' ? 'Main' : 'Onboarding'}
        >
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen
            name="Result"
            component={ResultScreen}
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="Translate"
            component={TranslateScreen}
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ShareIntentProvider>
  );
};
