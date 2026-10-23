// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useBilling } from "@/hooks/billing/useBilling";

vi.mock("@/hooks/billing/useActivePricing", () => ({
  useActivePricing: () => ({
    pricing: {
      currency: "USD",
      symbol: "$",
      monthlyAmount: 2,
      annualAmount: 19.2,
      annualMonthlyCost: 1.6,
      annualSavingPercent: 20,
    },
    isPending: false,
  }),
}));

vi.mock("@/services/flutterwave", () => ({
  openFlutterwaveCheckout: vi.fn(),
  reconcileFlutterwaveStatus: vi.fn(),
  verifyTransaction: vi.fn(),
  isFlutterwaveAvailable: vi.fn(),
  getFlutterwavePlanId: vi.fn((isAnnual: boolean) =>
    isAnnual ? "ekwe_pro_annual" : "ekwe_pro_monthly",
  ),
}));

vi.mock("@/services/auth", () => ({
  fetchSessionUser: vi.fn(),
}));

vi.mock("@/services/mmkv", () => ({
  mmkv: { getString: vi.fn(), set: vi.fn(), getBoolean: vi.fn() },
}));

vi.mock("@/utils/alert", () => ({
  AppAlert: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/analytics", () => ({
  AnalyticsEvents: { PURCHASE_SUCCESS: "purchase_success" },
  track: vi.fn(),
}));

vi.mock("@/store", () => {
  const session = { get: vi.fn(() => null) };
  const isPro = { get: vi.fn(() => false) };
  const authActions = { setSession: vi.fn() };
  return { auth$: { session, isPro }, authActions };
});

import {
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  verifyTransaction,
  isFlutterwaveAvailable,
} from "@/services/flutterwave";
import { fetchSessionUser } from "@/services/auth";
import { AppAlert } from "@/utils/alert";
import { auth$ } from "@/store";

const mockSession = auth$.session.get as Mock;
const mockIsPro = auth$.isPro.get as Mock;
const mockFetchUser = fetchSessionUser as Mock;
const mockOpenCheckout = openFlutterwaveCheckout as Mock;
const mockReconcile = reconcileFlutterwaveStatus as Mock;
const mockVerify = verifyTransaction as Mock;
const mockIsAvailable = isFlutterwaveAvailable as Mock;

const PREMIUM_USER = { id: "u1", email: "a@b.co", tier: "PREMIUM" };
const FREE_USER = { id: "u1", email: "a@b.co", tier: "FREE" };

describe("useBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: {} });
    mockIsPro.mockReturnValue(false);
    mockIsAvailable.mockReturnValue(true);
    mockFetchUser.mockResolvedValue(PREMIUM_USER);
    mockVerify.mockResolvedValue({ ok: false });
    mockReconcile.mockResolvedValue(false);
    vi.useRealTimers();
  });

  describe("handleUpgrade", () => {
    it("asks for an account when signed out", async () => {
      mockSession.mockReturnValue(null);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "Account Required",
        expect.any(String),
      );
      expect(mockOpenCheckout).not.toHaveBeenCalled();
    });

    it("shows payment-unavailable when Flutterwave is not available", async () => {
      mockIsAvailable.mockReturnValue(false);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "Payment Unavailable",
        expect.any(String),
      );
      expect(mockOpenCheckout).not.toHaveBeenCalled();
    });

    it("opens checkout and celebrates when the paid plan reconciles", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        session: {
          tx_ref: "ekwe_test-user-123_monthly_1234",
          amount: 2,
          currency: "USD",
          link: "https://checkout.flutterwave.com/pay/test",
        },
      });
      mockReconcile.mockResolvedValue(true);
      const { result } = await renderHook(() => useBilling());
      expect(result.current.isAnnual).toBe(true);

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(mockOpenCheckout).toHaveBeenCalledWith(true);
      expect(result.current.showCheckout).toBe(true);
      expect(result.current.checkoutSession).toEqual({
        tx_ref: "ekwe_test-user-123_monthly_1234",
        amount: 2,
        currency: "USD",
        link: "https://checkout.flutterwave.com/pay/test",
      });
      expect(result.current.checkoutPlan).toBe("ekwe_pro_annual");

      await act(async () => {
        await result.current.handleCheckoutComplete({
          status: "successful",
          tx_ref: "ekwe_test-user-123_monthly_1234",
          transaction_id: "123",
        });
      });

      expect(mockReconcile).toHaveBeenCalled();
      expect(AppAlert.success).toHaveBeenCalledWith(
        "Welcome to Ekwe Paid!",
        expect.any(String),
      );
    });

    it("opens checkout for monthly when the toggle is monthly", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        session: {
          tx_ref: "ekwe_test-user-123_monthly_1234",
          amount: 2,
          currency: "USD",
          link: "https://checkout.flutterwave.com/pay/test",
        },
      });
      mockReconcile.mockResolvedValue(true);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        result.current.setIsAnnual(false);
      });
      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(mockOpenCheckout).toHaveBeenCalledWith(false);
      expect(result.current.checkoutPlan).toBe("ekwe_pro_monthly");
    });

    it("does not open the sheet when the checkout is canceled", async () => {
      mockOpenCheckout.mockResolvedValue({ canceled: true, session: null });
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(result.current.showCheckout).toBe(false);
      expect(result.current.checkoutSession).toBeNull();
      expect(mockReconcile).not.toHaveBeenCalled();
      expect(AppAlert.success).not.toHaveBeenCalled();
    });

    it("does not open the sheet when the checkout has no payment link", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        session: {
          tx_ref: "ekwe_test-user-123_monthly_1234",
          amount: 2,
          currency: "USD",
        },
      });
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(AppAlert.error).toHaveBeenCalledWith(
        "Payment Unavailable",
        expect.any(String),
      );
      expect(result.current.showCheckout).toBe(false);
    });

    it("tells the user when the payment cannot be confirmed yet", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        session: {
          tx_ref: "ekwe_test-user-123_monthly_1234",
          amount: 2,
          currency: "USD",
          link: "https://checkout.flutterwave.com/pay/test",
        },
      });
      mockReconcile.mockResolvedValue(false);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      await act(async () => {
        await result.current.handleCheckoutComplete({
          status: "successful",
          tx_ref: "ekwe_test-user-123_monthly_1234",
          transaction_id: "123",
        });
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "Payment Pending",
        expect.any(String),
      );
      expect(AppAlert.success).not.toHaveBeenCalled();
    });

    it("shows upgrade-failed for checkout errors", async () => {
      mockOpenCheckout.mockRejectedValue(new Error("Payment method rejected"));
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(AppAlert.error).toHaveBeenCalledWith(
        "Upgrade Failed",
        expect.any(Error),
      );
    });

    it("exposes the annual toggle for the billing screen", async () => {
      const { result } = await renderHook(() => useBilling());
      expect(result.current.isAnnual).toBe(true);

      await act(async () => {
        result.current.setIsAnnual(false);
      });
      expect(result.current.isAnnual).toBe(false);
    });
  });

  describe("handleRestore", () => {
    it("reports Paid when the worker says the account is Premium", async () => {
      mockFetchUser.mockResolvedValue(PREMIUM_USER);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockFetchUser).toHaveBeenCalled();
      expect(AppAlert.success).toHaveBeenCalledWith(
        "Paid Plan Active",
        expect.any(String),
      );
    });

    it("reports no paid access when the account is free", async () => {
      mockFetchUser.mockResolvedValue(FREE_USER);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "No Active Paid Plan",
        expect.any(String),
      );
    });
  });
});
