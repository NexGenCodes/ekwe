import { LinkingOptions } from '@react-navigation/native';

export const linking: LinkingOptions<ReactNavigation.RootParamList> = {
  prefixes: ['ekwe://'],
  config: {
    screens: {
      Main: {
        screens: {
          Home: 'home',
          History: 'history',
          Settings: 'settings',
        },
      },
      Result: 'result',
    },
  },
};
