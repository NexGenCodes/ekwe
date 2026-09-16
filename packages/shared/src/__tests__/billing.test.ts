import { describe, expect, it } from "vitest";

import {
  PAYMENT_PROVIDERS,
  SUBSCRIPTION_PLANS,
  DEFAULT_FEATURE_FLAGS,
  BILLING_ERROR_CODES,
  getAvailableProviders,
  getEffectiveProvider,
  type PaymentFeatureFlags,
} from "../billing";
import { WORKER_ERROR_CODES } from "../errors";

describe("PAYMENT_PROVIDERS", () => {
  it("contains flutterwave", () => {
    expect(PAYMENT_PROVIDERS.FLUTTERWAVE).toBe("flutterwave");
  });
});

describe("SUBSCRIPTION_PLANS", () => {
  it("has monthly and annual plans with correct durations", () => {
    expect(SUBSCRIPTION_PLANS.MONTHLY.duration).toBe("monthly");
    expect(SUBSCRIPTION_PLANS.ANNUAL.duration).toBe("annual");
    expect(SUBSCRIPTION_PLANS.MONTHLY.id).toBe("ekwe_pro_monthly");
    expect(SUBSCRIPTION_PLANS.ANNUAL.id).toBe("ekwe_pro_annual");
  });
});

describe("DEFAULT_FEATURE_FLAGS", () => {
  it("enables flutterwave and sets it as default provider", () => {
    expect(DEFAULT_FEATURE_FLAGS.flutterwave_enabled).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.default_provider).toBe("flutterwave");
  });
});

describe("BILLING_ERROR_CODES", () => {
  it("derives every code from WORKER_ERROR_CODES (no drift)", () => {
    expect(BILLING_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID).toBe(
      WORKER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
    );
    expect(BILLING_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED).toBe(
      WORKER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED,
    );
    expect(BILLING_ERROR_CODES.WEBHOOK_MISSING_HEADERS).toBe(
      WORKER_ERROR_CODES.WEBHOOK_MISSING_HEADERS,
    );
    expect(BILLING_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE).toBe(
      WORKER_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE,
    );
    expect(BILLING_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED).toBe(
      WORKER_ERROR_CODES.PAYMENT_INITIALIZATION_FAILED,
    );
  });
});

describe("getAvailableProviders", () => {
  it("returns flutterwave when enabled", () => {
    const flags: PaymentFeatureFlags = {
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    };
    expect(getAvailableProviders(flags, "android")).toEqual(["flutterwave"]);
    expect(getAvailableProviders(flags, "ios")).toEqual(["flutterwave"]);
    expect(getAvailableProviders(flags, "web")).toEqual(["flutterwave"]);
  });

  it("returns empty array when flutterwave is disabled", () => {
    const flags: PaymentFeatureFlags = {
      flutterwave_enabled: false,
      default_provider: "flutterwave",
    };
    expect(getAvailableProviders(flags, "android")).toEqual([]);
  });
});

describe("getEffectiveProvider", () => {
  it("returns the default provider when it is available", () => {
    const flags: PaymentFeatureFlags = {
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    };
    expect(getEffectiveProvider(flags, "android")).toBe("flutterwave");
  });

  it("returns null when no providers are available", () => {
    const flags: PaymentFeatureFlags = {
      flutterwave_enabled: false,
      default_provider: "flutterwave",
    };
    expect(getEffectiveProvider(flags, "android")).toBeNull();
  });
});
