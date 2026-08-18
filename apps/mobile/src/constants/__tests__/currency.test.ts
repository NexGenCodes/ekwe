import * as Localization from "expo-localization";

import { detectDeviceCurrency } from "@/constants/currency";

jest.mock("expo-localization", () => ({
  getLocales: jest.fn(),
}));

const mockGetLocales = Localization.getLocales as jest.Mock;

describe("detectDeviceCurrency", () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
  });

  test("prefers the device region over the locale currencyCode (Android en-US phone in Nigeria)", () => {
    mockGetLocales.mockReturnValue([
      { languageTag: "en-US", currencyCode: "USD", regionCode: "NG" },
    ]);
    expect(detectDeviceCurrency()).toBe("NGN");
  });

  test("maps the region code to its currency, uppercased", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "ng", currencyCode: "USD" }]);
    expect(detectDeviceCurrency()).toBe("NGN");
  });

  test("falls back to the device locale currencyCode when the region is unknown", () => {
    mockGetLocales.mockReturnValue([
      { regionCode: "XA", currencyCode: "ngn" },
    ]);
    expect(detectDeviceCurrency()).toBe("NGN");
  });

  test("uses the device locale currencyCode when no region is reported", () => {
    mockGetLocales.mockReturnValue([{ currencyCode: "ngn" }]);
    expect(detectDeviceCurrency()).toBe("NGN");
  });

  test("falls back to USD when no locales are available", () => {
    mockGetLocales.mockReturnValue([]);
    expect(detectDeviceCurrency()).toBe("USD");
  });

  test("falls back to USD when the currencyCode is not a 3-letter code", () => {
    mockGetLocales.mockReturnValue([{ regionCode: "XA", currencyCode: "US" }]);
    expect(detectDeviceCurrency()).toBe("USD");
  });

  test("falls back to USD when getLocales throws", () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error("localization unavailable");
    });
    expect(detectDeviceCurrency()).toBe("USD");
  });
});