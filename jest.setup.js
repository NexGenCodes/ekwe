/**
 * Global Jest Setup — Ekwe
 *
 * Centralises mocks for native modules that crash in a pure-JS test
 * environment.
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
    BlurView: ({ children }) => children,
  };
});

/* ------------------------------------------------------------------ */
/*  lucide-react-native — return simple Views with testIDs             */
/* ------------------------------------------------------------------ */
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const RN = require('react-native');

  const createIcon = (name) => {
    const Icon = (props) => {
      const { testID, ...rest } = props;
      return <RN.View {...rest} testID={testID || `icon-${name}`} />;
    };
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
    },
  );
});

/* ------------------------------------------------------------------ */
/*  react-native-safe-area-context                                     */
/* ------------------------------------------------------------------ */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    SafeAreaView: ({ children }) => children,
    SafeAreaProvider: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

/* ------------------------------------------------------------------ */
/*  @op-engineering/op-sqlite                                         */
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
    // Helper to simulate incoming URL in tests
    _dispatchUrl: (url) => {
      listeners.forEach((l) => l({ url }));
    },
    _resetListeners: () => {
      listeners.length = 0;
    },
  };
});

/* ------------------------------------------------------------------ */
/*  crypto.randomUUID                                                  */
/* ------------------------------------------------------------------ */
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: jest.fn().mockReturnValue('test-uuid-1234'),
  },
});
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  expo-file-system                                                   */
/* ------------------------------------------------------------------ */
jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn().mockResolvedValue({
    exists: true,
    size: 1024 * 1024, // 1MB default
    uri: 'file://test.m4a',
  }),
  File: jest.fn().mockImplementation(() => ({
    exists: true,
    size: 1024 * 1024,
  })),
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
/*  @/services/supabase & @/store                                     */
/* ------------------------------------------------------------------ */
jest.mock('@/services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest
        .fn()
        .mockResolvedValue({
          data: {
            session: { access_token: 'mock-token', user: { id: 'user_123' } },
          },
        }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
    from: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ error: null }),
  },
  appStateSubscription: { remove: jest.fn() },
}));

jest.mock('@/store', () => ({
  auth$: {
    get: () => ({
      session: null,
      user: null,
      isPro: false,
      isInitialized: true,
    }),
  },
  authActions: {
    setSession: jest.fn(),
    setUser: jest.fn(),
    setIsPro: jest.fn(),
    clearAuth: jest.fn(),
  },
  settings$: { get: () => ({ onboardingCompleted: false }) },
  history$: { get: () => ({}) },
  audio$: { get: () => ({}) },
}));

/* ------------------------------------------------------------------ */
/*  @/utils/authHeaders (Global Mock)                                  */
/* ------------------------------------------------------------------ */
jest.mock('src/utils/authHeaders', () => ({
  getAuthHeaders: jest.fn(async (h = {}) => ({
    ...h,
    Authorization: 'Bearer mock-token',
  })),
}));
