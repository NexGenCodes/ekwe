import { Platform } from "react-native";

describe("platform", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("detects iOS", () => {
    Object.defineProperty(Platform, "OS", { get: () => "ios" });
    const {
      isIOS,
      isAndroid,
      isWeb,
      getPlatform,
      selectPlatform,
    } = require("../platform");
    expect(isIOS).toBe(true);
    expect(isAndroid).toBe(false);
    expect(isWeb).toBe(false);
    expect(getPlatform()).toBe("ios");
    expect(selectPlatform({ ios: "A", android: "B" })).toBe("A");
  });

  it("detects Android", () => {
    Object.defineProperty(Platform, "OS", { get: () => "android" });
    const {
      isIOS,
      isAndroid,
      isWeb,
      getPlatform,
      selectPlatform,
    } = require("../platform");
    expect(isIOS).toBe(false);
    expect(isAndroid).toBe(true);
    expect(isWeb).toBe(false);
    expect(getPlatform()).toBe("android");
    expect(selectPlatform({ ios: "A", android: "B" })).toBe("B");
  });

  it("falls back to android when web is not provided", () => {
    Object.defineProperty(Platform, "OS", { get: () => "web" });
    const { selectPlatform } = require("../platform");
    expect(selectPlatform({ ios: "A", android: "B" })).toBe("B");
  });

  it("uses web option when provided", () => {
    Object.defineProperty(Platform, "OS", { get: () => "web" });
    const { selectPlatform } = require("../platform");
    expect(selectPlatform({ ios: "A", android: "B", web: "C" })).toBe("C");
  });
});
