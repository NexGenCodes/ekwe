import { act, renderHook } from "@testing-library/react-native";

import { useBilling } from "@/hooks/billing/useBilling";

jest.mock("@/hooks/billing/useActivePricing", () => ({
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

jest.mock("@/hooks/billing/usePaymentProvider", () => ({
  usePaymentProvider: () => ({
    provider: "flutterwave",
    availableProviders: ["flutterwave"],
    featureFlags: {
      flutterwave_enabled: true,
      default_provider: "flutterwave",
    },
    isLoading: false,
    isFlutterwave: true,
  }),
}));

jest.mock("@/services/flutterwave", () => ({
  openFlutterwaveCheckout: jest.fn(),
  reconcileFlutterwaveStatus: jest.fn(),
  isFlutterwaveAvailable: jest.fn(),
}));

jest.mock("@/services/supabase", () => ({
  supabase: { auth: { refreshSession: jest.fn() } },
}));

jest.mock("@/services/mmkv", () => ({
  mmkv: { getString: jest.fn(), set: jest.fn(), getBoolean: jest.fn() },
}));

jest.mock("@/utils/alert", () => ({
  AppAlert: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/store", () => {
  const session = { get: jest.fn(() => null) };
  const isPro = { get: jest.fn(() => false) };
  const authActions = {
    setSession: jest.fn(),
    setIsPro: jest.fn(),
    setEntitlementSynced: jest.fn(),
    resetEntitlementForProviderSwitch: jest.fn(),
  };
  return { auth$: { session, isPro }, authActions };
});

import {
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  isFlutterwaveAvailable,
} from "@/services/flutterwave";
import { supabase } from "@/services/supabase";
import { AppAlert } from "@/utils/alert";
import { auth$, authActions } from "@/store";

const mockSession = auth$.session.get as jest.Mock;
const mockIsPro = auth$.isPro.get as jest.Mock;
const mockRefreshSession = supabase.auth.refreshSession as jest.Mock;
const mockOpenCheckout = openFlutterwaveCheckout as jest.Mock;
const mockReconcile = reconcileFlutterwaveStatus as jest.Mock;
const mockIsAvailable = isFlutterwaveAvailable as jest.Mock;

const PRO_SESSION = {
  user: { app_metadata: { is_pro: true } },
};
const FREE_SESSION = {
  user: { app_metadata: { is_pro: false } },
};

describe("useBilling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockReturnValue({ user: {} });
    mockIsPro.mockReturnValue(false);
    mockIsAvailable.mockReturnValue(true);
    mockRefreshSession.mockResolvedValue({
      data: { session: PRO_SESSION },
      error: null,
    });
    mockReconcile.mockResolvedValue(false);
    jest.useRealTimers();
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

    it("opens checkout and celebrates when pro reconciles", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        checkoutUrl: "https://checkout.flutterwave.com/abc",
        txRef: "tx_abc",
      });
      mockReconcile.mockResolvedValue(true);
      const { result } = await renderHook(() => useBilling());
      expect(result.current.isAnnual).toBe(true);

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(mockOpenCheckout).toHaveBeenCalledWith(true);
      expect(result.current.showCheckout).toBe(true);
      expect(result.current.checkoutUrl).toBe(
        "https://checkout.flutterwave.com/abc",
      );

      await act(async () => {
        await result.current.handleCheckoutComplete({
          status: "successful",
          tx_ref: "tx_abc",
          transaction_id: "123",
        });
      });

      expect(mockReconcile).toHaveBeenCalled();
      expect(authActions.setIsPro).toHaveBeenCalledWith(true);
      expect(AppAlert.success).toHaveBeenCalledWith(
        "Welcome to Pro!",
        expect.any(String),
      );
    });

    it("opens checkout for monthly when the toggle is monthly", async () => {
      mockOpenCheckout.mockResolvedValue({ canceled: false, txRef: "tx_abc" });
      mockReconcile.mockResolvedValue(true);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        result.current.setIsAnnual(false);
      });
      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(mockOpenCheckout).toHaveBeenCalledWith(false);
    });

    it("does not reconcile when the user cancels the checkout", async () => {
      mockOpenCheckout.mockResolvedValue({ canceled: true, txRef: null });
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      expect(mockReconcile).not.toHaveBeenCalled();
      expect(AppAlert.success).not.toHaveBeenCalled();
    });

    it("shows a syncing message when the purchase succeeds but pro never reconciles", async () => {
      mockOpenCheckout.mockResolvedValue({
        canceled: false,
        checkoutUrl: "https://checkout.flutterwave.com/abc",
        txRef: "tx_abc",
      });
      mockReconcile.mockResolvedValue(false);
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleUpgrade();
      });

      await act(async () => {
        await result.current.handleCheckoutComplete({
          status: "successful",
          tx_ref: "tx_abc",
          transaction_id: "123",
        });
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "Syncing Status",
        expect.any(String),
      );
    });

    it("shows upgrade-failed for checkout errors", async () => {
      mockOpenCheckout.mockRejectedValue(
        new Error("Payment method rejected"),
      );
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

  describe("handleManage", () => {
    it("directs user to billing portal", async () => {
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleManage();
      });

      expect(AppAlert.info).toHaveBeenCalledWith(
        "Manage Subscription",
        expect.any(String),
      );
    });
  });

  describe("handleRestore", () => {
    it("refreshes session and reports pro status", async () => {
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(mockRefreshSession).toHaveBeenCalled();
      expect(authActions.setIsPro).toHaveBeenCalledWith(true);
      expect(AppAlert.success).toHaveBeenCalledWith(
        "Subscription Active",
        expect.any(String),
      );
    });

    it("reports no subscription when session is free", async () => {
      mockRefreshSession.mockResolvedValue({
        data: { session: FREE_SESSION },
        error: null,
      });
      const { result } = await renderHook(() => useBilling());

      await act(async () => {
        await result.current.handleRestore();
      });

      expect(authActions.setIsPro).toHaveBeenCalledWith(false);
      expect(AppAlert.info).toHaveBeenCalledWith(
        "No Active Subscription",
        expect.any(String),
      );
    });
  });
});
