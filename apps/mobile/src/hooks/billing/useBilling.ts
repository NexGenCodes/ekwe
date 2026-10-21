import { useValue } from "@legendapp/state/react";
import { useState, useRef, useCallback } from "react";

import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { BILLING_PLANS } from "@/constants/billing";
import { supabase } from "@/services/supabase";
import {
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  verifyTransaction,
  isFlutterwaveAvailable,
  getFlutterwavePlanId,
  type CheckoutSession,
} from "@/services/flutterwave";
import { auth$, authActions } from "@/store";
import { AppAlert } from "@/utils/alert";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";

export interface UseBillingReturn {
  isPro: boolean;
  isAnnual: boolean;
  setIsAnnual: (isAnnual: boolean) => void;
  handleUpgrade: () => Promise<void>;
  handleRestore: () => Promise<void>;
  freePlan: typeof BILLING_PLANS.free;
  proPlan: typeof BILLING_PLANS.pro;
  annualSavingPercent: number;
  loading: boolean;

  showCheckout: boolean;

  checkoutSession: CheckoutSession | null;

  checkoutPlan: string | null;

  handleCheckoutComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;

  handleCheckoutDismiss: () => void;
}

const FLUTTERWAVE_UNAVAILABLE_TITLE = "Payment Unavailable";
const FLUTTERWAVE_UNAVAILABLE_MESSAGE =
  "Online payments are not available. Please try again later.";

export function useBilling(): UseBillingReturn {
  const isPro = useValue(() => auth$.isPro.get());
  const [isAnnual, setIsAnnual] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutSession, setCheckoutSession] =
    useState<CheckoutSession | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const { pricing } = useActivePricing();

  const checkoutSessionRef = useRef<CheckoutSession | null>(null);
  const checkoutPlanRef = useRef<string | null>(null);

  const handleUpgrade = async (): Promise<void> => {
    const session = auth$.session.get();
    if (!session) {
      AppAlert.info(
        "Account Required",
        "Please sign in or create an account to upgrade to Ekwe Pro.",
      );
      return;
    }

    if (!isFlutterwaveAvailable()) {
      AppAlert.info(
        FLUTTERWAVE_UNAVAILABLE_TITLE,
        FLUTTERWAVE_UNAVAILABLE_MESSAGE,
      );
      return;
    }

    setLoading(true);
    try {
      const outcome = await openFlutterwaveCheckout(isAnnual);
      if (outcome.canceled || !outcome.session) return;
      if (!outcome.session.link) {
        AppAlert.error(
          "Payment Unavailable",
          "Could not open the payment page. Please try again later.",
        );
        return;
      }
      setCheckoutSession(outcome.session);
      setCheckoutPlan(getFlutterwavePlanId(isAnnual));
      checkoutSessionRef.current = outcome.session;
      checkoutPlanRef.current = getFlutterwavePlanId(isAnnual);
      track(AnalyticsEvents.CHECKOUT_INITIATED, {
        plan: getFlutterwavePlanId(isAnnual),
        cycle: isAnnual ? "annual" : "monthly",
      });
      setShowCheckout(true);
    } catch (err) {
      AppAlert.error("Upgrade Failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutComplete = useCallback(
    async (data: {
      status: string | null;
      tx_ref: string | null;
      transaction_id: string | null;
    }) => {
      setShowCheckout(false);
      setCheckoutSession(null);
      setCheckoutPlan(null);

      const session = checkoutSessionRef.current;

      if (data.status === "successful" && data.transaction_id) {
        try {
          const txId = Number(data.transaction_id);
          if (!Number.isNaN(txId)) {
            const result = await verifyTransaction(txId);
            if (result.ok) {
              authActions.setIsPro(true);
              authActions.setEntitlementSynced(true);
              track(AnalyticsEvents.PURCHASE_SUCCESS, {
                plan: checkoutPlanRef.current ?? null,
                amount: session?.amount ?? null,
                currency: session?.currency ?? null,
              });
              AppAlert.success(
                "Welcome to Pro!",
                "Your Pro access is active. Thank you for supporting Ekwe!",
              );
              return;
            }
          }
        } catch {
          // Verify failed — fall through to polling fallback
        }
      }

      const upgraded = await reconcileFlutterwaveStatus();
      if (upgraded) {
        authActions.setIsPro(true);
        authActions.setEntitlementSynced(true);
        track(AnalyticsEvents.PURCHASE_SUCCESS, {
          plan: checkoutPlanRef.current ?? null,
          amount: session?.amount ?? null,
          currency: session?.currency ?? null,
        });
        AppAlert.success(
          "Welcome to Pro!",
          "Your Pro access is active. Thank you for supporting Ekwe!",
        );
        return;
      }

      AppAlert.info(
        "Payment Pending",
        "We could not confirm your payment yet. If you were charged, Pro will activate automatically once the payment provider confirms it.",
      );
    },
    [],
  );

  const handleCheckoutDismiss = useCallback(() => {
    setShowCheckout(false);
    setCheckoutSession(null);
    setCheckoutPlan(null);
    checkoutSessionRef.current = null;
    checkoutPlanRef.current = null;
  }, []);

  const handleRestore = async (): Promise<void> => {
    try {
      const { data: sessionData, error } = await supabase.auth.refreshSession();
      if (error) throw error;

      const upgraded = sessionData.session?.user?.app_metadata?.is_pro === true;
      authActions.setIsPro(upgraded);
      if (upgraded) {
        authActions.setEntitlementSynced(true);
      }

      if (upgraded) {
        AppAlert.success("Pro Active", "Your Pro access is active.");
      } else {
        AppAlert.info(
          "No Active Pro Access",
          "We could not find active Pro access on this account. If you believe this is an error, please contact support.",
        );
      }
    } catch (err) {
      logger.error("[billing] Pro status check failed", err);
      AppAlert.error(
        "Status Check Failed",
        "Could not check your Pro status. Please check your connection and try again.",
      );
    }
  };

  return {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
    handleRestore,
    freePlan: BILLING_PLANS.free,
    proPlan: BILLING_PLANS.pro,
    annualSavingPercent: pricing.annualSavingPercent,
    loading,
    showCheckout,
    checkoutSession,
    checkoutPlan,
    handleCheckoutComplete,
    handleCheckoutDismiss,
  };
}
