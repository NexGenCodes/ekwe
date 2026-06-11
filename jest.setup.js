/**
 * Global Jest Setup — Ekwe
 *
 * Only essential polyfills and native module stubs that are needed
 * by every test. Test-specific mocks live next to their tests.
 */

// Babel in SDK 52 + Jest sometimes requires the Promise constructor to be explicitly global
if (typeof Promise === 'undefined') {
  global.Promise = require('promise');
}

/* ------------------------------------------------------------------ */
/*  react-native-reanimated v4                                         */
/* ------------------------------------------------------------------ */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const RN = require('react-native');

  const createAnimatedComponent = (Component) => {
    const Animated = React.forwardRef((props, ref) => {
      return <Component {...props} ref={ref} />;
    });
    Animated.displayName = `Animated(${Component.displayName || Component.name || 'Component'})`;
    return Animated;
  };

  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      FlatList: RN.FlatList,
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
      bezier: () => (x) => x,
      bezierFn: () => (x) => x,
      in: () => (x) => x,
      out: () => (x) => x,
      inOut: () => (x) => x,
    },
    FadeIn: {
      duration: () => ({ springify: () => ({ damping: () => ({}) }) }),
    },
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
    GestureHandlerRootView: ({ children }) => children,
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
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({ close: jest.fn() }));
      return (
        <RN.View>
          {renderRightActions?.()}
          {children}
        </RN.View>
      );
    }),
  };
});

/* ------------------------------------------------------------------ */
/*  expo-haptics — needed by AudioService at import time               */
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
/*  @op-engineering/op-sqlite                                          */
/* ------------------------------------------------------------------ */
const mockOpDb = {
  executeSync: jest.fn(() => ({ rows: [], rowsAffected: 0 })),
  execute: jest.fn(() => Promise.resolve({ rows: [], rowsAffected: 0 })),
  close: jest.fn(),
};
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockOpDb),
  openAsync: jest.fn(() => Promise.resolve(mockOpDb)),
}));

/* ------------------------------------------------------------------ */
/*  expo-linking                                                       */
/* ------------------------------------------------------------------ */
jest.mock('expo-linking', () => {
  const listeners = [];
  return {
    addEventListener: jest.fn((type, handler) => {
      if (type === 'url') {
        listeners.push(handler);
        return {
          remove: () => listeners.splice(listeners.indexOf(handler), 1),
        };
      }
      return { remove: () => {} };
    }),
    getInitialURL: jest.fn().mockResolvedValue(null),
    parse: jest.fn((url) => {
      const uriMatch = url.match(/[?&]uri=([^&]+)/);
      const uri = uriMatch ? decodeURIComponent(uriMatch[1]) : 'test.mp3';
      return {
        scheme: 'ekwe',
        hostname: 'share',
        path: '',
        queryParams: { uri },
      };
    }),
    _dispatchUrl: (url) => {
      listeners.forEach((l) => l({ url }));
    },
    _resetListeners: () => {
      listeners.length = 0;
    },
  };
});

/* ------------------------------------------------------------------ */
/*  react-native-mmkv                                                  */
/* ------------------------------------------------------------------ */
jest.mock('react-native-mmkv', () => {
  const mockStorage = {
    getString: jest.fn(() => null),
    set: jest.fn(),
    getAllKeys: jest.fn(() => []),
    clearAll: jest.fn(),
    delete: jest.fn(),
    contains: jest.fn(() => false),
    getNumber: jest.fn(() => 0),
    getBoolean: jest.fn(() => false),
  };
  return {
    createMMKV: jest.fn(() => mockStorage),
    MMKV: jest.fn(() => mockStorage),
  };
});

/* ------------------------------------------------------------------ */
/*  @react-native-google-signin/google-signin                          */
/* ------------------------------------------------------------------ */
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    getTokens: jest.fn().mockResolvedValue({ idToken: 'mock-google-token' }),
  },
}));

/* ------------------------------------------------------------------ */
/*  crypto.randomUUID                                                  */
/* ------------------------------------------------------------------ */
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn().mockReturnValue('test-uuid-1234'),
  },
});

/* ------------------------------------------------------------------ */
/*  expo-file-system                                                   */
/* ------------------------------------------------------------------ */
jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn().mockResolvedValue({
    exists: true,
    size: 1024 * 1024,
    uri: 'file://test.m4a',
  }),
  File: jest.fn().mockImplementation((uri) => ({
    exists: true,
    size: 1024 * 1024,
    uri,
  })),
  Paths: {
    cache: {
      list: jest.fn().mockReturnValue([]),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  ekwe-native local module                                           */
/* ------------------------------------------------------------------ */
jest.mock('./modules/ekwe-native', () => ({
  hasOverlayPermission: jest.fn().mockResolvedValue(true),
  requestOverlayPermission: jest.fn().mockResolvedValue(undefined),
  startBubbleService: jest.fn().mockResolvedValue(undefined),
  stopBubbleService: jest.fn().mockResolvedValue(undefined),
  getSavedPosition: jest.fn().mockResolvedValue(null),
  savePosition: jest.fn().mockResolvedValue(undefined),
  attachEffects: jest.fn().mockResolvedValue({
    noiseSuppressor: true,
    echoCanceler: true,
    gainControl: true,
  }),
  releaseEffects: jest.fn().mockResolvedValue(undefined),
}));

/* ------------------------------------------------------------------ */
/*  @/store                                                            */
/* ------------------------------------------------------------------ */
const makeObservable = (val) => {
  const observable = (newVal) => {
    if (newVal !== undefined) val = newVal;
    return val;
  };
  observable.get = () => val;
  observable.peek = () => val;
  observable.set = (v) => { val = v; };
  observable.delete = () => { val = undefined; };
  return observable;
};

const mockAuthVal = {
  session: null,
  user: null,
  isPro: false,
  isInitialized: false,
  transactionsUsed: 0,
  activeTier: 'FREE',
  isFallback: false,
};

const mockHistory = {};

jest.mock('@/store', () => ({
  auth$: new Proxy(makeObservable(mockAuthVal), {
    get(target, prop) {
      if (prop === 'get') return target.get;
      if (prop === 'peek') return target.peek;
      if (prop === 'set') return target.set;
      return makeObservable(mockAuthVal[prop]);
    },
  }),
  authActions: {
    setSession: jest.fn(),
    setUser: jest.fn(),
    setIsPro: jest.fn(),
    setInitialized: jest.fn((v) => { mockAuthVal.isInitialized = v; }),
    clearAuth: jest.fn(),
    updateBilling: jest.fn(),
  },
  settings$: makeObservable({ onboardingCompleted: false }),
  history$: new Proxy(makeObservable({}), {
    get(target, prop) {
      if (prop === 'get') return target.get;
      if (prop === 'peek') return target.peek;
      if (prop === 'set') return target.set;
      if (!mockHistory[prop]) {
        mockHistory[prop] = makeObservable(null);
      }
      return mockHistory[prop];
    },
  }),
  audio$: makeObservable({}),
}));


