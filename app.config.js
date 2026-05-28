module.exports = ({ config }) => {
  // Toggle architectures based on build context:
  // Production releases build all active ABIs to support all Android devices.
  // Local development compiles only for 64-bit ARM to speed up execution.
  const isProduction =
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true' ||
    process.env.NODE_ENV === 'production';

  const reactNativeArchitectures = isProduction
    ? 'armeabi-v7a,arm64-v8a,x86,x86_64'
    : 'arm64-v8a';

  const plugins = (config.plugins || [])
    .filter((plugin) => {
      if (
        typeof plugin === 'string' &&
        plugin.includes('@react-native-google-signin')
      ) {
        return false;
      }
      return true;
    })
    .map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
        return [
          'expo-build-properties',
          {
            ...plugin[1],
            android: {
              ...(plugin[1] ? plugin[1].android : {}),
              reactNativeArchitectures,
            },
          },
        ];
      }
      return plugin;
    });

  plugins.push([
    'react-native-nitro-auth',
    {
      ios: {
        googleClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        googleServerClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        googleUrlScheme: `com.googleusercontent.apps.${process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID}`,
        appleSignIn: true,
      },
      android: {
        googleClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      },
    },
  ]);

  return {
    ...config,
    plugins,
  };
};
