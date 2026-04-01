import * as Sentry from '@sentry/react-native';

export const initialiseSentry = (): void => {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    environment: process.env.EXPO_PUBLIC_ENV ?? 'development',
    enabled: process.env.EXPO_PUBLIC_ENV === 'production',
    tracesSampleRate: 0.2,
  });
};
