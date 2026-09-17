import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerForPushNotifications,
  setupNotificationTapListener,
} from "../notifications";

const constState = vi.hoisted(() => ({
  projectId: "eas-proj-123",
  version: "1.0.0",
}));
const devState = vi.hoisted(() => ({ isDevice: true }));

const getWorkerUrlMock = vi.hoisted(() => vi.fn(() => "https://worker.test"));
const getTokenMock = vi.hoisted(() => vi.fn(() => "auth-token"));

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
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
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

vi.mock("@/utils/networkUtils", () => ({
  getWorkerUrl: getWorkerUrlMock,
}));

vi.mock("@/utils/logger", () => ({
  default: loggerMock,
  captureSentryMessage: vi.fn(),
  setSentryUser: vi.fn(),
}));

vi.mock("@/store/auth", () => ({
  getToken: getTokenMock,
}));

import * as Notifications from "expo-notifications";

import logger from "@/utils/logger";

beforeEach(() => {
  devState.isDevice = true;
  constState.projectId = "eas-proj-123";
  constState.version = "1.0.0";
  getWorkerUrlMock.mockReturnValue("https://worker.test");
  getTokenMock.mockReturnValue("auth-token");
  vi.clearAllMocks();
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const result = await registerForPushNotifications();

    expect(result).toBe("ExpoPushToken[test]");
    expect(fetchSpy).toHaveBeenCalledWith("https://worker.test/push-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer auth-token",
      },
      body: JSON.stringify({
        push_token: "ExpoPushToken[test]",
        platform: "ios",
        app_version: "1.0.0",
      }),
    });
  });

  it("requests permissions when they are not granted yet", async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: "undetermined",
    } as never);
    vi.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({
      status: "granted",
    } as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await registerForPushNotifications();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await registerForPushNotifications();
    expect(result).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when token generation fails", async () => {
    vi.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValue(
      new Error("firebase not configured"),
    );
    const result = await registerForPushNotifications();
    expect(result).toBeNull();
  });

  it("skips storing the token when no worker URL is configured", async () => {
    getWorkerUrlMock.mockReturnValue("");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await registerForPushNotifications();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[Notifications] No worker URL — push token not stored",
    );
  });

  it("logs when storing the token fails at the server", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status: 500 }));
    await registerForPushNotifications();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[Notifications] Failed to store push token:",
      expect.any(Number),
      expect.any(String),
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
});
