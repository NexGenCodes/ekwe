import { vi } from "vitest";

// Mock Expo Modules Core
vi.mock("expo-modules-core", () => ({
  EventEmitter: class {},
  NativeModulesProxy: {},
  requireNativeModule: () => ({}),
}));

// Mock Expo
vi.mock("expo", () => ({
  requireNativeModule: () => ({}),
}));

// Native JSI bridge (react-native-nitro-modules). Loading the real package pulls
// in `react-native` whose index.js ships Flow syntax (`import typeof`) that breaks
// Node's/pure-JS parsing. Unit tests never touch native audio, so stub it out.
vi.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: () => ({}),
  },
}));

// Mock Expo File System
vi.mock("expo-file-system", () => ({
  documentDirectory: "file:///mock/document/directory/",
  cacheDirectory: "file:///mock/cache/directory/",
  makeDirectoryAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(),
  getInfoAsync: vi.fn(() => ({ exists: true })),
}));

// Mock Expo Speech
vi.mock("expo-speech", () => ({
  speak: vi.fn(),
  stop: vi.fn(),
  VoiceQuality: {
    Default: "Default",
    Enhanced: "Enhanced",
  },
}));

vi.mock("expo-asset", () => ({
  Asset: { loadAsync: vi.fn() },
}));

const mockExpoDb = {
  execSync: vi.fn(),
  withExclusiveTransactionSync: vi.fn((fn) => fn()),
  runSync: vi.fn(() => ({ changes: 0 })),
  getFirstSync: vi.fn(() => ({ count: 0 })),
};

vi.mock("expo-sqlite", () => ({
  openDatabaseSync: vi.fn(() => mockExpoDb),
}));

vi.mock("drizzle-orm/expo-sqlite", () => ({
  drizzle: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          run: vi.fn(),
        })),
        run: vi.fn(),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 0 })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              all: vi.fn(() => []),
            })),
            all: vi.fn(() => []),
          })),
          all: vi.fn(() => []),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            all: vi.fn(() => []),
          })),
          all: vi.fn(() => []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn(() => ({ changes: 0 })),
        })),
      })),
    })),
  })),
}));

// Real expo-modules-core reads `globalThis.expo.modules` when evaluated in a
// non-Expo runtime. Provide a benign shim so the module body executes cleanly.
globalThis.expo = {
  modules: {
    EventEmitter: class {},
    UnavailabilityError: class extends Error {},
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

vi.mock("expo-clipboard", () => ({
  getStringAsync: vi.fn(async () => ""),
  setStringAsync: vi.fn(async () => true),
}));

vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: vi.fn(async () => {}),
  deactivateKeepAwake: vi.fn(async () => {}),
  useKeepAwake: vi.fn(),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Heavy: "Heavy", Medium: "Medium", Light: "Light" },
  NotificationFeedbackType: {
    Success: "Success",
    Warning: "Warning",
    Error: "Error",
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => Math.random().toString(36).slice(2)),
  getRandomValues: vi.fn((arr) => arr),
}));

vi.mock("react-native-mmkv", () => ({
  createMMKV: vi.fn(() => ({
    getString: vi.fn(() => undefined),
    getNumber: vi.fn(() => undefined),
    set: vi.fn(),
    getBoolean: vi.fn(() => undefined),
  })),
  MMKV: class {
    getString = vi.fn(() => undefined);
    getNumber = vi.fn(() => undefined);
    set = vi.fn();
    getBoolean = vi.fn(() => undefined);
  },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    fetch: vi.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
    addEventListener: vi.fn((cb) => {
      cb({ isConnected: true });
      return () => {};
    }),
  },
}));

vi.mock("sonner-native", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("expo-audio", () => ({
  useAudioPlayer: vi.fn(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
  })),
  useAudioPlayerStatus: vi.fn(() => ({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    didJustFinish: false,
  })),
  setAudioModeAsync: vi.fn(),
  createAudioPlayer: vi.fn(() => ({ play: vi.fn() })),
}));
