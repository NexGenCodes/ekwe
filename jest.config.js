/** @type {import('jest').Config} */
const config = {
  preset: "jest-expo",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/worker/", "/node_modules/"],
  transform: {
    "^.+\\.[jt]sx?$|^.+\\.mjs$": [
      "babel-jest",
      { caller: { name: "metro", bundler: "metro", platform: "ios" } },
    ],
  },
  setupFilesAfterEnv: [
    "@testing-library/jest-native/extend-expect",
    "./jest.setup.js",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^src/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|native-base|react-native-svg|lucide-react-native|sonner-native|@open-draft|rettime|until-async)",
  ],
  collectCoverageFrom: [
    "src/utils/**/*.ts",
    "src/constants/**/*.ts",
    "src/types/**/*.ts",
    "src/store/**/*.ts",
    "src/hooks/**/*.ts",
    "src/services/**/*.ts",
    "!src/utils/index.ts",
    "!src/constants/mockData.ts",
    "!src/**/index.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 30,
      functions: 50,
      lines: 40,
    },
    "./src/utils/": {
      statements: 60,
      branches: 50,
      functions: 70,
      lines: 60,
    },
    "./src/services/": {
      statements: 40,
      branches: 30,
      functions: 50,
      lines: 40,
    },
    "./src/types/": {
      statements: 80,
      branches: 50,
      functions: 80,
      lines: 80,
    },
  },
};

module.exports = config;
