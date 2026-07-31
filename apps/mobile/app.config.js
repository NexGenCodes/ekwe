module.exports = ({ config }) => {
  // Dev builds: build only for the connected device's CPU architecture.
  // Pass the detected arch via EXPO_PUBLIC_DEV_ARCH (set by the android script).
  // Production releases: build all active ABIs to support all Android devices.
  const isProduction =
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true' ||
    process.env.NODE_ENV === 'production';

  const reactNativeArchitectures = isProduction
    ? 'armeabi-v7a,arm64-v8a,x86,x86_64'
    : process.env.EXPO_PUBLIC_DEV_ARCH || 'arm64-v8a';

  const plugins = (config.plugins || [])
    .map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
        return [
          'expo-build-properties',
          {
            ...plugin[1],
            android: {
              compileSdkVersion: 36,
              targetSdkVersion: 36,
              minSdkVersion: 24,
              ndkVersion: '27.1.12297006',
              reactNativeArchitectures,
            },
          },
        ];
      }
      return plugin;
    });

  plugins.push([
    '@react-native-google-signin/google-signin',
    {
      iosUrlScheme: `com.googleusercontent.apps.${process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID}`,
    },
  ]);

  plugins.push('expo-asset');

  const sentryIndex = plugins.findIndex(
    (p) => p === '@sentry/react-native' || (Array.isArray(p) && p[0] === '@sentry/react-native'),
  );

  if (sentryIndex !== -1) {
    plugins[sentryIndex] = [
      '@sentry/react-native',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
      },
    ];
  }

  return {
    ...config,
    plugins,
  };
};
