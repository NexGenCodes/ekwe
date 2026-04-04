import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  NavigatorScreenParams,
  CompositeScreenProps,
} from '@react-navigation/native';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

export type OnboardingStackParams = {
  FeatureOne: undefined;
  FeatureTwo: undefined;
  Language: undefined;
  AllSet: undefined;
};

export type MainTabsParams = {
  Home: undefined;
  History: undefined;
  Settings: undefined;
};

export type MainStackParams = {
  MainTabs: NavigatorScreenParams<MainTabsParams>;
  Result: {
    entryId?: string;
    isLive?: boolean;
  };
};

export type RootStackParams = {
  Welcome: undefined;
  Onboarding: NavigatorScreenParams<OnboardingStackParams>;
  Main: NavigatorScreenParams<MainStackParams>;
};

// Typed navigation props — import these in screens
export type RootScreenProps<T extends keyof RootStackParams> =
  NativeStackScreenProps<RootStackParams, T>;

export type OnboardingScreenProps<T extends keyof OnboardingStackParams> =
  CompositeScreenProps<
    NativeStackScreenProps<OnboardingStackParams, T>,
    NativeStackScreenProps<RootStackParams>
  >;

export type MainTabScreenProps<T extends keyof MainTabsParams> =
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParams, T>,
    NativeStackScreenProps<MainStackParams>
  >;

export type ResultScreenProps = NativeStackScreenProps<
  MainStackParams,
  'Result'
>;

// Exporting navigation prop types for usage in components if needed
export type OnboardingNavigationProp<T extends keyof OnboardingStackParams> =
  NativeStackNavigationProp<OnboardingStackParams, T>;
