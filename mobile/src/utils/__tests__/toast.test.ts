import * as Haptics from "expo-haptics";

import { AppToast } from "../toast";

jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  }),
}));
const { toast } = jest.requireMock("sonner-native");

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Error: "error",
    Warning: "warning",
  },
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));
const logger = jest.requireMock("@/utils/logger").default;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AppToast.info", () => {
  it("calls toast with title and default duration", () => {
    AppToast.info("Hello");
    expect(toast).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({
        description: undefined,
        duration: 3000,
        richColors: true,
      }),
    );
  });

  it("calls Haptics.impactAsync with Light by default", () => {
    AppToast.info("Hello");
    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Light,
    );
  });

  it("respects haptics: false", () => {
    AppToast.info("Hello", { haptics: false });
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("passes description and custom duration", () => {
    AppToast.info("Hi", { description: "Detail", duration: 5000 });
    expect(toast).toHaveBeenCalledWith(
      "Hi",
      expect.objectContaining({
        description: "Detail",
        duration: 5000,
        richColors: true,
      }),
    );
  });
});

describe("AppToast.success", () => {
  it("calls toast.success with title and default duration", () => {
    AppToast.success("Done!");
    expect(toast.success).toHaveBeenCalledWith(
      "Done!",
      expect.objectContaining({
        description: undefined,
        duration: 3000,
        richColors: true,
      }),
    );
  });

  it("calls Haptics.notificationAsync with Success by default", () => {
    AppToast.success("Done!");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it("respects haptics: false", () => {
    AppToast.success("Done!", { haptics: false });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});

describe("AppToast.error", () => {
  it("calls toast.error with title and default 4000ms", () => {
    AppToast.error("Fail");
    expect(toast.error).toHaveBeenCalledWith(
      "Fail",
      expect.objectContaining({
        description: undefined,
        duration: 4000,
        richColors: true,
      }),
    );
  });

  it("calls Haptics.notificationAsync with Error by default", () => {
    AppToast.error("Fail");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("respects haptics: false", () => {
    AppToast.error("Fail", { haptics: false });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("extracts description from string error", () => {
    AppToast.error("Fail", { error: "Something went wrong" });
    expect(toast.error).toHaveBeenCalledWith(
      "Fail",
      expect.objectContaining({
        description: "Something went wrong",
        duration: 4000,
        richColors: true,
      }),
    );
  });

  it("extracts description from Error instance", () => {
    AppToast.error("Fail", { error: new Error("Boom") });
    expect(toast.error).toHaveBeenCalledWith(
      "Fail",
      expect.objectContaining({
        description: "Boom",
        duration: 4000,
        richColors: true,
      }),
    );
  });

  it("extracts description from object with message", () => {
    AppToast.error("Fail", { error: { message: "Oops" } });
    expect(toast.error).toHaveBeenCalledWith(
      "Fail",
      expect.objectContaining({
        description: "Oops",
        duration: 4000,
        richColors: true,
      }),
    );
  });

  it("logs error when description or error present", () => {
    AppToast.error("Fail", { error: "Something went wrong" });
    expect(logger.error).toHaveBeenCalledWith(
      "[AppToast Error] Fail - Something went wrong",
    );
  });

  it("logs unknown error when error has no message", () => {
    AppToast.error("Fail", { error: {} });
    expect(logger.error).toHaveBeenCalledWith(
      "[AppToast Error] Fail - Unknown error",
    );
  });

  it("does not log when no error or description", () => {
    AppToast.error("Fail");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
