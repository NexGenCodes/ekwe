/* global __dirname */
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// Remove deprecated option that triggers a validation warning
delete config.watcher.unstable_workerThreads;

// Exclude worker app directory and its node_modules from file mapping and watching
const workerExclusion = /[/\\]apps[/\\]worker[/\\]/;

config.resolver.blockList = Array.isArray(config.resolver.blockList)
  ? [...config.resolver.blockList, workerExclusion]
  : [workerExclusion];

// Watch the shared package so Metro resolves @ekwe/shared imports
config.watchFolders = [
  path.resolve(__dirname, '..', '..', 'packages', 'shared'),
];

// Strip non-critical console.* calls from production bundles. Runs only in
// production exports (dev builds are never minified). Keep error/warn so
// Sentry breadcrumbs and crash context are preserved.
config.transformer.minifierConfig = {
  compress: {
    drop_console: ['log', 'info', 'warn', 'debug'],
  },
};

module.exports = config;
