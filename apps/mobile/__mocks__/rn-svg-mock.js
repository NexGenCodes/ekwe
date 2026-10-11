// Stub for react-native-svg under Vitest.
//
// The real package loads ESM-from-CJS through Node's own loader, which resolves
// its `react-native` import to the Flow source in node_modules and fails on a
// `typeof` token. Aliasing here keeps icon imports renderable so components can
// be mounted in tests.
const React = require("react");

const element = (tag) => (props) =>
  React.createElement(tag, props, props?.children);

const Svg = element("svg");

module.exports = new Proxy(
  { __esModule: true, Svg, default: Svg },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      const tag = prop.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      return element(tag);
    },
  },
);
