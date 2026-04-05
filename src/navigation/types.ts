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
  Welcome: undefined;
  Language: undefined;
  AllSet: undefined;
};

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Settings: undefined;
};

export type MainStackParams = {
  MainTabs: NavigatorScreenParams<TabParamList>;
  Result: {
    entryId?: string;
    isLive?: boolean;
  };
};

export type RootStackParams = {
  Welcome: undefined;
  Onboarding: NavigatorScreenParams<OnboardingStackParams>;
  Main: NavigatorScreenParams<MainStackParams>;
  Result: {
    uri?: string; // For shared voice notes
    sessionId?: string;
    entryId?: string;
    transcript?: string;
    sourceLang?: string;
    targetLang?: string;
    isLive?: boolean;
    isHistoryReplay?: boolean;
    duration?: number;
  };
  Translate: {
    text: string;
    detectedLang?: string;
  };
};

// Typed navigation props — import these in screens
export type RootScreenProps<T extends keyof RootStackParams> =
  NativeStackScreenProps<RootStackParams, T>;

export type OnboardingScreenProps<T extends keyof OnboardingStackParams> =
  CompositeScreenProps<
    NativeStackScreenProps<OnboardingStackParams, T>,
    NativeStackScreenProps<RootStackParams>
  >;

export type MainTabScreenProps<T extends keyof TabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<TabParamList, T>,
    NativeStackScreenProps<MainStackParams>
  >;

export type ResultScreenProps = NativeStackScreenProps<
  RootStackParams,
  'Result'
>;

// Exporting navigation prop types for usage in components if needed
export type OnboardingNavigationProp<T extends keyof OnboardingStackParams> =
  NativeStackNavigationProp<OnboardingStackParams, T>;
