// Mock React Native module for Vitest pure logic tests
module.exports = {
  Platform: {
    OS: 'ios',
    select: (objs) => objs['ios'] || objs.default,
  },
  NativeModules: {},
  StyleSheet: {
    create: (styles) => styles,
  },
  // Add other required mocks as needed by hooks
};
