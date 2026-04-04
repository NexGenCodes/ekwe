/**
 * Global Jest Setup — Ekwe
 *
 * Centralises mocks for native modules that crash in a pure-JS test
 * environment.  Individual test files only need to mock things specific
 * to their component (e.g. useTheme token values).
 */

/* ------------------------------------------------------------------ */
/*  react-native-worklets — must come BEFORE reanimated                */
/* ------------------------------------------------------------------ */
jest.mock('react-native-worklets', () => ({
  createWorkletFromJSFunction: jest.fn(),
  defaultValueUnpackerCode: '',
}));

/* ------------------------------------------------------------------ */
/*  react-native-reanimated v4                                         */
/* ------------------------------------------------------------------ */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const RN = require('react-native');

  const createAnimatedComponent = (Component) => {
    const Animated = React.forwardRef((props, ref) =>
      React.createElement(Component, { ...props, ref })
    );
    Animated.displayName = `Animated(${Component.displayName || Component.name || 'Component'})`;
    return Animated;
  };

  return {
    __esModule: true,
    default: {
      View: createAnimatedComponent(RN.View),
      Text: createAnimatedComponent(RN.Text),
      Image: createAnimatedComponent(RN.Image),
      ScrollView: createAnimatedComponent(RN.ScrollView),
      FlatList: createAnimatedComponent(RN.FlatList),
      createAnimatedComponent,
    },
    useSharedValue: (val) => ({ value: val }),
    useAnimatedStyle: (fn) => fn(),
    useDerivedValue: (fn) => ({ value: fn() }),
    useAnimatedScrollHandler: () => jest.fn(),
    withSpring: (val) => val,
    withTiming: (val) => val,
    withRepeat: (val) => val,
    withSequence: (...args) => args[args.length - 1],
    withDelay: (_d, val) => val,
    cancelAnimation: jest.fn(),
    interpolateColor: (_val, _range, output) => output[0],
    Easing: {
      linear: (x) => x,
      ease: (x) => x,
      in: () => (x) => x,
      out: () => (x) => x,
      inOut: () => (x) => x,
    },
    FadeIn: { duration: () => ({ springify: () => ({ damping: () => ({}) }) }) },
    FadeOut: { duration: () => ({}) },
    FadeInUp: { springify: () => ({ damping: () => ({}) }) },
    FadeOutUp: {},
    FadeInDown: { springify: () => ({ damping: () => ({}) }) },
    FadeOutDown: {},
    SlideInRight: {},
    SlideOutRight: {},
    createAnimatedComponent,
  };
});

/* ------------------------------------------------------------------ */
/*  react-native-gesture-handler                                       */
/* ------------------------------------------------------------------ */
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const RN = require('react-native');

  return {
    GestureHandlerRootView: ({ children }) =>
      React.createElement(RN.View, null, children),
    GestureDetector: ({ children }) => children,
    Gesture: {
      Pan: () => ({
        enabled: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        runOnJS: jest.fn().mockReturnThis(),
      }),
      Tap: () => ({
        enabled: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
        runOnJS: jest.fn().mockReturnThis(),
      }),
      Exclusive: jest.fn(),
    },
    Swipeable: React.forwardRef(function MockSwipeable(
      { children, renderRightActions },
      ref
    ) {
      React.useImperativeHandle(ref, () => ({ close: jest.fn() }));
      return React.createElement(RN.View, null,
        children,
        React.createElement(RN.View, { testID: 'right-actions' },
          renderRightActions ? renderRightActions() : null
        )
      );
    }),
  };
});

/* ------------------------------------------------------------------ */
/*  expo-haptics                                                       */
/* ------------------------------------------------------------------ */
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

/* ------------------------------------------------------------------ */
/*  expo-blur                                                          */
/* ------------------------------------------------------------------ */
jest.mock('expo-blur', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    BlurView: ({ children, ...props }) =>
      React.createElement(RN.View, props, children),
  };
});

/* ------------------------------------------------------------------ */
/*  lucide-react-native — return simple Views with testIDs             */
/* ------------------------------------------------------------------ */
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const RN = require('react-native');

  const createIcon = (name) => {
    const Icon = (props) =>
      React.createElement(RN.View, { testID: `icon-${name}`, ...props });
    Icon.displayName = name;
    return Icon;
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__esModule') return true;
        return createIcon(prop);
      },
    }
  );
});

/* ------------------------------------------------------------------ */
/*  react-native-safe-area-context                                     */
/* ------------------------------------------------------------------ */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    SafeAreaView: ({ children, style }) =>
      React.createElement(RN.View, { style }, children),
    SafeAreaProvider: ({ children }) =>
      React.createElement(RN.View, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

/* ------------------------------------------------------------------ */
/*  react-native-mmkv                                                  */
/* ------------------------------------------------------------------ */
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clearAll: jest.fn(),
  })),
}));

/* ------------------------------------------------------------------ */
/*  @sentry/react-native                                               */
/* ------------------------------------------------------------------ */
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setExtra: jest.fn(),
  addBreadcrumb: jest.fn(),
  Native: {
    init: jest.fn(),
  },
}));
