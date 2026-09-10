const fs = require('node:fs');
const path = require('node:path');

function readSharedVersion() {
  const versionTsPath = path.resolve(__dirname, '../../packages/shared/version.ts');
  const content = fs.readFileSync(versionTsPath, 'utf8');
  const version = content.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const versionCode = content.match(/APP_VERSION_CODE\s*=\s*(\d+)/)?.[1];
  if (!version || !versionCode) {
    throw new Error(`Could not parse APP_VERSION/APP_VERSION_CODE from ${versionTsPath}`);
  }
  return { version, versionCode: Number(versionCode) };
}

module.exports = ({ config }) => {
  // Version lives in packages/shared/version.ts (single source of truth).
  const { version, versionCode } = readSharedVersion();

  // Dev builds: build only for the connected device's CPU architecture.
  // Pass the detected arch via EXPO_PUBLIC_DEV_ARCH (set by the android script).
  // Production releases: build all active ABIs to support all Android devices.
  const isProduction =
    process.env.APP_ENV === 'production' ||
    process.env.EAS_BUILD === 'true' ||
    process.env.NODE_ENV === 'production';

  const reactNativeArchitectures = isProduction
    ? 'armeabi-v7a,arm64-v8a'
    : process.env.EXPO_PUBLIC_DEV_ARCH || 'arm64-v8a';

  const plugins = (config.plugins || [])
    .map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
        // Preserve every option that app.json declares for this plugin
        // (minify, shrinkResources, extraProguardRules, buildArchs, png
        // crunch, ...) and only override the fields this file owns.
        const previous = plugin[1] || {};
        return [
          'expo-build-properties',
          {
            ...previous,
            android: {
              ...(previous.android || {}),
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
    version,
    android: {
      ...config.android,
      versionCode,
    },
    ios: {
      ...config.ios,
      buildNumber: String(versionCode),
    },
    plugins,
  };
};
