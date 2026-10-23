import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerForPushNotifications,
  setupNotificationTapListener,
} from "@/services/notifications";

const constState = vi.hoisted(() => ({
  projectId: "eas-proj-123",
  version: "1.0.0",
}));
const devState = vi.hoisted(() => ({ isDevice: true }));
const sessionState = vi.hoisted(() => ({
  current: { user: { id: "u1" } } as { user: { id: string } } | null,
}));
const pushTokenListenerState = vi.hoisted(() => ({
  listener: null as ((token: unknown) => Promise<void>) | null,
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => {}),
  getPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExpoPushToken[test]" })),
  addPushTokenListener: vi.fn((cb: (token: unknown) => Promise<void>) => {
    pushTokenListenerState.listener = cb;
    return { remove: vi.fn() };
  }),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  AndroidImportance: { HIGH: "high" },
}));

vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return {
        version: constState.version,
        extra: { eas: { projectId: constState.projectId } },
      };
    },
  },
}));

vi.mock("expo-device", () => ({
  get isDevice() {
    return devState.isDevice;
  },
}));

vi.mock("@/utils/logger", () => ({
  default: loggerMock,
  setSentryUser: vi.fn(),
}));

vi.mock("@/store/auth", () => ({
  auth$: {
    session: { peek: () => sessionState.current },
  },
}));

vi.mock("@/services/backend", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message?: string) {
      super(message ?? code);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    ApiError,
    apiJson: vi.fn(),
    isApiError: vi.fn((err: unknown) => err instanceof ApiError),
  };
});

vi.mock("expo-router", () => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));

import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { apiJson, ApiError } from "@/services/backend";
import logger from "@/utils/logger";

beforeEach(() => {
  devState.isDevice = true;
  constState.projectId = "eas-proj-123";
  constState.version = "1.0.0";
  sessionState.current = { user: { id: "u1" } };
  vi.clearAllMocks();
  vi.mocked(apiJson).mockResolvedValue({ ok: true } as never);
  vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: "granted",
  } as never);
  vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
    status: "granted",
  } as never);
  vi.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
    data: "ExpoPushToken[test]",
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerForPushNotifications", () => {
  it("returns null on a simulator (not a physical device)", async () => {
    devState.isDevice = false;
    const result = await registerForPushNotifications();
    expect(result).toBeNull();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it("registers a push token and stores it in the worker", async () => {
    const result = await registerForPushNotifications();

    expect(result).toBe("ExpoPushToken[test]");
    expect(apiJson).toHaveBeenCalledWith(
      "/devices/token",
      expect.objectContaining({
        method: "POST",
        body: {
          push_token: "ExpoPushToken[test]",
          platform: "ios",
          app_version: "1.0.0",
        },
        timeoutMs: 10_000,
        retries: 1,
      }),
    );
  });

  it("requests permissions when they are not granted yet", async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: "undetermined",
    } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      status: "granted",
    } as never);

    await registerForPushNotifications();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it("returns null when permission is denied", async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: "denied",
    } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      status: "denied",
    } as never);

    const result = await registerForPushNotifications();
    expect(result).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it("returns null when no EAS project id is configured", async () => {
    constState.projectId = "YOUR_PROJECT_ID";
    const result = await registerForPushNotifications();
    expect(result).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(apiJson).not.toHaveBeenCalled();
  });

  it("never throws when token generation fails", async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(
      new Error("firebase not configured"),
    );
    const result = await registerForPushNotifications();
    expect(result).toBeNull();
  });

  it("skips the worker while signed out", async () => {
    sessionState.current = null;

    const result = await registerForPushNotifications();

    expect(result).toBe("ExpoPushToken[test]");
    expect(apiJson).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "[Notifications] No session — push token not stored",
    );
  });

  it("treats a 401 as a signed-out no-op", async () => {
    vi.mocked(apiJson).mockRejectedValue(
      new ApiError(401, "unauthorized", "expired"),
    );

    const result = await registerForPushNotifications();

    expect(result).toBe("ExpoPushToken[test]");
    expect(logger.info).toHaveBeenCalledWith(
      "[Notifications] Push token not stored: signed out",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("is non-blocking when storing the token hits a network error", async () => {
    vi.mocked(apiJson).mockRejectedValue(
      new Error(
        "fetch failed: java.net.UnknownHostException: Unable to resolve host",
      ),
    );

    const result = await registerForPushNotifications();

    expect(result).toBe("ExpoPushToken[test]");
    expect(logger.warn).toHaveBeenCalledWith(
      "[Notifications] Failed to store push token (non-blocking):",
      expect.any(Error),
    );
  });
});

describe("push token refresh listener", () => {
  it("re-registers the rotated device token", async () => {
    await pushTokenListenerState.listener?.({ data: "device-token" });

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "eas-proj-123",
      devicePushToken: { data: "device-token" },
    });
    expect(apiJson).toHaveBeenCalledWith(
      "/devices/token",
      expect.objectContaining({
        body: expect.objectContaining({ push_token: "ExpoPushToken[test]" }),
      }),
    );
  });

  it("logs a refresh failure without throwing", async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValueOnce(
      new Error("firebase unavailable"),
    );

    await pushTokenListenerState.listener?.({ data: "device-token" });

    expect(logger.warn).toHaveBeenCalledWith(
      "[Notifications] Token refresh re-register failed:",
      expect.any(Error),
    );
  });
});

describe("setupNotificationTapListener", () => {
  it("logs the tapped notification and returns a cleanup that unsubscribes", () => {
    let listener: ((response: never) => void) | null = null;
    const remove = vi.fn();
    vi.mocked(
      Notifications.addNotificationResponseReceivedListener,
    ).mockImplementation(((cb: (response: never) => void) => {
      listener = cb;
      return { remove } as never;
    }) as never);

    const cleanup = setupNotificationTapListener();

    (listener as ((response: never) => void) | null)?.({
      notification: {
        request: { content: { data: { type: "new_translation" } } },
      },
    } as never);

    expect(logger.info).toHaveBeenCalledWith(
      "[Notifications] Notification tapped:",
      JSON.stringify({ type: "new_translation" }),
    );

    cleanup();
    expect(remove).toHaveBeenCalled();
  });

  it("navigates to a URL carried by the notification", () => {
    let listener: ((response: never) => void) | null = null;
    vi.mocked(
      Notifications.addNotificationResponseReceivedListener,
    ).mockImplementation(((cb: (response: never) => void) => {
      listener = cb;
      return { remove: vi.fn() } as never;
    }) as never);

    const cleanup = setupNotificationTapListener();

    (listener as ((response: never) => void) | null)?.({
      notification: {
        request: { content: { data: { url: "/history/42" } } },
      },
    } as never);

    expect(router.push).toHaveBeenCalledWith("/history/42");
    cleanup();
  });

  it("logs a failed route push without throwing", () => {
    let listener: ((response: never) => void) | null = null;
    vi.mocked(
      Notifications.addNotificationResponseReceivedListener,
    ).mockImplementation(((cb: (response: never) => void) => {
      listener = cb;
      return { remove: vi.fn() } as never;
    }) as never);
    vi.mocked(router.push).mockImplementationOnce(() => {
      throw new Error("bad route");
    });

    const cleanup = setupNotificationTapListener();

    (listener as ((response: never) => void) | null)?.({
      notification: {
        request: { content: { data: { url: "/missing" } } },
      },
    } as never);

    expect(logger.warn).toHaveBeenCalledWith(
      "[Notifications] Failed to push notification route:",
      expect.any(Error),
    );
    cleanup();
  });
});
