const jestExpoPreset = require('jest-expo/jest-preset');

// Additional packages shipping ESM source that must be Babel-transformed for
// tests, on top of jest-expo's default allow-list.
const ESM_PACKAGES = ['lucide-react-native', '@op-engineering/op-sqlite'];
const extraAlternation = ESM_PACKAGES.join('|');

const DEFAULT_IGNORE =
  '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))';

module.exports = {
  ...jestExpoPreset,
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    ...jestExpoPreset.moduleNameMapper,
  },
  transform: {
    // Transform ESM-shipped packages (e.g. lucide-react-native's .mjs icons,
    // op-sqlite's lib) with the same Babel pipeline as the rest of the app.
    '^.+\\.mjs$': jestExpoPreset.transform['\\.[jt]sx?$'],
    ...jestExpoPreset.transform,
  },
  transformIgnorePatterns: [
    // Start from jest-expo's default allow-list, then additionally transform
    // the ESM-shipped packages above.
    ...jestExpoPreset.transformIgnorePatterns.map((p) =>
      p === DEFAULT_IGNORE
        ? `/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|${extraAlternation}))`
        : p,
    ),
  ],
};
