const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// Remove deprecated option that triggers a validation warning
delete config.watcher.unstable_workerThreads;

module.exports = withNativeWind(config, { input: './global.css' });
