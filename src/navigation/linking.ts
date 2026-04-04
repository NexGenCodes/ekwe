import { LinkingOptions } from '@react-navigation/native';
import { RootStackParams } from 'src/navigation/types';

export const linking: LinkingOptions<RootStackParams> = {
  prefixes: ['ekwe://'],
  config: {
    screens: {
      Main: {
        screens: {
          Result: 'share',
          MainTabs: {
            screens: {
              Home: 'home',
              History: 'history',
              Settings: 'settings',
            },
          },
        },
      },
    },
  },
};
