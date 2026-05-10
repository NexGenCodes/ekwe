import { ShareIntentProvider as Provider } from 'expo-share-intent';
import { ReactNode } from 'react';
import { Platform } from 'react-native';

interface Props {
  children: ReactNode;
}

/**
 * PRO-LEVEL: This provider wraps the entire application.
 * On Android, our custom ShareActivity handles all intents natively,
 * so we bypass expo-share-intent completely to avoid 'addListener of null' errors.
 * On iOS, expo-share-intent is still required.
 */
export function ShareIntentProvider({ children }: Props): ReactNode {
  if (Platform.OS === 'android') {
    return children;
  }

  return (
    <Provider
      options={{
        debug: __DEV__,
        resetOnBackground: true,
      }}
    >
      {children}
    </Provider>
  );
}
