/* global __dirname */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

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

module.exports = config;
