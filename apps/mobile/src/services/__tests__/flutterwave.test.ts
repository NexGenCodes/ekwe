import { DEFAULT_PAYMENT_CURRENCY } from "@ekwe/shared/money";
import { PRO_PRODUCT_IDS } from "@ekwe/shared/plans";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/store/auth";

vi.mock("@/services/backend", () => ({ apiJson: vi.fn() }));

vi.mock("@/services/auth", () => ({ fetchSessionUser: vi.fn() }));

import { apiJson } from "@/services/backend";
import { fetchSessionUser } from "@/services/auth";
import {
  getFlutterwavePlanId,
  isFlutterwaveAvailable,
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  verifyTransaction,
} from "@/services/flutterwave";
import { authActions } from "@/store";
import { settingsActions } from "@/store";

const validCheckout = {
  tx_ref: "flw_tx_1",
  amount: 4900,
  currency: "USD",
  public_key: "pk_live_test",
};

const validVerify = {
  ok: true,
  permanent: true,
  transaction_id: 123456,
  tx_ref: "flw_tx_1",
};

function makeSession(tier: "FREE" | "PREMIUM" = "FREE"): AuthSession {
  return {
    user: {
      id: "user-1",
      email: "a@b.com",
      tier,
      displayName: null,
      avatarUrl: null,
      avatarIcon: null,
      proExpiresAt: null,
    },
    accessToken: "access-token-123",
    expiresAt: Date.now() + 60_000,
    refreshToken: "refresh",
    refreshExpiresAt: Date.now() + 86_400_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authActions.setSession(null);
  settingsActions.setCurrency(DEFAULT_PAYMENT_CURRENCY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getFlutterwavePlanId", () => {
  it("maps the billing toggle to the shared product IDs", () => {
    expect(getFlutterwavePlanId(false)).toBe(PRO_PRODUCT_IDS.monthly);
    expect(getFlutterwavePlanId(true)).toBe(PRO_PRODUCT_IDS.annual);
  });
});

describe("isFlutterwaveAvailable", () => {
  it("is false without a session", () => {
    expect(isFlutterwaveAvailable()).toBe(false);
  });

  it("is true with a session", () => {
    authActions.setSession(makeSession());
    expect(isFlutterwaveAvailable()).toBe(true);
  });
});

describe("openFlutterwaveCheckout", () => {
  it("authorizes a monthly checkout in the selected currency", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockResolvedValue(validCheckout as never);

    const result = await openFlutterwaveCheckout(false);

    expect(result).toEqual({ canceled: false, session: validCheckout });
    expect(apiJson).toHaveBeenCalledWith(
      "/billing/checkout",
      expect.objectContaining({
        method: "POST",
        body: {
          plan: PRO_PRODUCT_IDS.monthly,
          currency: DEFAULT_PAYMENT_CURRENCY,
        },
      }),
    );
  });

  it("sends the manual currency selection", async () => {
    authActions.setSession(makeSession());
    settingsActions.setCurrency("NGN");
    vi.mocked(apiJson).mockResolvedValue(validCheckout as never);

    await openFlutterwaveCheckout(false);

    expect(apiJson).toHaveBeenCalledWith(
      "/billing/checkout",
      expect.objectContaining({
        body: { plan: PRO_PRODUCT_IDS.monthly, currency: "NGN" },
      }),
    );
  });

  it("requests the annual plan when toggled", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockResolvedValue(validCheckout as never);

    await openFlutterwaveCheckout(true);

    expect(apiJson).toHaveBeenCalledWith(
      "/billing/checkout",
      expect.objectContaining({
        body: expect.objectContaining({ plan: PRO_PRODUCT_IDS.annual }),
      }),
    );
  });

  it("wraps a failed request", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockRejectedValue(new Error("429"));

    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
  });

  it("wraps a checkout response that fails the shared schema", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockResolvedValue({ tx_ref: "missing-fields" } as never);

    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
  });
});

describe("verifyTransaction", () => {
  it("verifies a transaction with the worker", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockResolvedValue(validVerify as never);

    await expect(verifyTransaction(123456)).resolves.toEqual(validVerify);
    expect(apiJson).toHaveBeenCalledWith(
      "/billing/verify-transaction",
      expect.objectContaining({
        method: "POST",
        body: { transaction_id: 123456 },
      }),
    );
  });

  it("fails on a request error", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockRejectedValue(new Error("nope"));

    await expect(verifyTransaction(123456)).rejects.toThrow("nope");
  });

  it("fails on a malformed verify response", async () => {
    authActions.setSession(makeSession());
    vi.mocked(apiJson).mockResolvedValue({ ok: false } as never);

    await expect(verifyTransaction(123456)).rejects.toThrow(
      "Failed to verify payment",
    );
  });
});

describe("reconcileFlutterwaveStatus", () => {
  it("returns true as soon as the session reports Paid", async () => {
    vi.mocked(fetchSessionUser).mockResolvedValue({
      ...makeSession("PREMIUM").user,
    });

    await expect(reconcileFlutterwaveStatus()).resolves.toBe(true);
    expect(fetchSessionUser).toHaveBeenCalledTimes(1);
  });

  it("polls and gives up when the account stays free", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSessionUser).mockResolvedValue(makeSession("FREE").user);

    const promise = reconcileFlutterwaveStatus();
    await vi.advanceTimersByTimeAsync(2_500 * 20);

    await expect(promise).resolves.toBe(false);
    expect(fetchSessionUser).toHaveBeenCalledTimes(20);
  });

  it("returns false when the user cannot be read", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSessionUser).mockResolvedValue(null);

    const promise = reconcileFlutterwaveStatus();
    await vi.advanceTimersByTimeAsync(2_500 * 20);

    await expect(promise).resolves.toBe(false);
  });
});
