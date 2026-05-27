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

  // The 'config' object passed here is the parsed app.json with the 'expo' key unwrapped.
  return {
    ...config,
    plugins: (config.plugins || []).map((plugin) => {
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
    }),
  };
};
