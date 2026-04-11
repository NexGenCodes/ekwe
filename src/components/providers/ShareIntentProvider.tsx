import { ShareIntentProvider as Provider } from 'expo-share-intent';
import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * PRO-LEVEL: This provider wraps the entire application to ensure that
 * share intent events (especially on cold starts) are captured as early
 * as possible in the React tree.
 */
export function ShareIntentProvider({ children }: Props) {
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
