// Vitest alias stub for posthog-react-native.
// The real package ships a CJS bundle with Flow `typeof` syntax that
// Node cannot parse. We short-circuit to this lightweight mock.
class PostHog {
  constructor() {}
  capture() {}
  identify() {}
  reset() {}
  screen() {}
  flush() {}
  shutdown() {}
  optIn() {}
  optOut() {}
  on() {}
  off() {}
  getFeatureFlag() { return false; }
}

module.exports = PostHog;
module.exports.default = PostHog;
module.exports.PostHog = PostHog;
