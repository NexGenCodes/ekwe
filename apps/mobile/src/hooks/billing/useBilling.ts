/**
 * ─── useBilling Hook ─────────────────────────────────────────────
 *
 * Client-side billing orchestrator. Delegates to the Flutterwave SDK
 * in-app modal checkout flow.
 *
 * The purchase flow writes to the `user_subscriptions` table in
 * Supabase via the `set_pro_status` RPC, so the tier resolution is
 * provider-agnostic.
 */

import { useSelector } from "@legendapp/state/react";
import { useState, useEffect, useRef, useCallback } from "react";

import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { usePaymentProvider } from "@/hooks/billing/usePaymentProvider";
import { BILLING_PLANS } from "@/constants/billing";
import { supabase } from "@/services/supabase";
import {
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  isFlutterwaveAvailable,
  getFlutterwavePlanId,
  type CheckoutSession,
} from "@/services/flutterwave";
import { auth$, authActions } from "@/store";
import { AppAlert } from "@/utils/alert";
import { AnalyticsEvents, track } from "@/utils/analytics";

export interface UseBillingReturn {
  isPro: boolean;
  isAnnual: boolean;
  setIsAnnual: (isAnnual: boolean) => void;
  handleUpgrade: () => Promise<void>;
  handleManage: () => Promise<void>;
  handleRestore: () => Promise<void>;
  freePlan: typeof BILLING_PLANS.free;
  proPlan: typeof BILLING_PLANS.pro;
  annualSavingPercent: number;
  loading: boolean;
  /** The currently active payment provider. */
  provider: "flutterwave" | null;
  /** Available providers for this platform. */
  availableProviders: "flutterwave"[];
  /** Whether the checkout sheet is visible. */
  showCheckout: boolean;
  /** The worker-authorized checkout session to feed the SDK. */
  checkoutSession: CheckoutSession | null;
  /** The plan id attached to the active checkout session. */
  checkoutPlan: string | null;
  /** Called when the SDK checkout completes (payment or redirect). */
  handleCheckoutComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;
  /** Called when the user dismisses the checkout sheet. */
  handleCheckoutDismiss: () => void;
}

// ─── Error Messages ──────────────────────────────────────────────

const FLUTTERWAVE_UNAVAILABLE_TITLE = "Payment Unavailable";
const FLUTTERWAVE_UNAVAILABLE_MESSAGE =
  "Online payments are not available. Please try again later.";

// ─── Hook ────────────────────────────────────────────────────────

export function useBilling(): UseBillingReturn {
  const isPro = useSelector(() => auth$.isPro.get());
  const [isAnnual, setIsAnnual] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutSession, setCheckoutSession] =
    useState<CheckoutSession | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const { pricing } = useActivePricing();
  const { provider, availableProviders } = usePaymentProvider();

  // Refs mirroring the checkout state so the memoized completion callback can
  // attach revenue metadata to the success event without stale closures.
  const checkoutSessionRef = useRef<CheckoutSession | null>(null);
  const checkoutPlanRef = useRef<string | null>(null);

  // Track previous provider to detect switches
  const prevProviderRef = useRef(provider);
  useEffect(() => {
    if (prevProviderRef.current !== provider) {
      // Provider switched: reset entitlement sync so the new provider
      // can take ownership of the Pro state.
      authActions.resetEntitlementForProviderSwitch();
      prevProviderRef.current = provider;
    }
  }, [provider]);

  // ── Upgrade Handler ──────────────────────────────────────────

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
      AppAlert.info(FLUTTERWAVE_UNAVAILABLE_TITLE, FLUTTERWAVE_UNAVAILABLE_MESSAGE);
      return;
    }

    setLoading(true);
    try {
      const outcome = await openFlutterwaveCheckout(isAnnual);
      if (outcome.canceled || !outcome.session) return;
      setCheckoutSession(outcome.session);
      setCheckoutPlan(getFlutterwavePlanId(isAnnual));
      checkoutSessionRef.current = outcome.session;
      checkoutPlanRef.current = getFlutterwavePlanId(isAnnual);
      setShowCheckout(true);
    } catch (err) {
      AppAlert.error("Upgrade Failed", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Checkout Complete ────────────────────────────────────────

  const handleCheckoutComplete = useCallback(
    async (_data: {
      status: string | null;
      tx_ref: string | null;
      transaction_id: string | null;
    }) => {
      setShowCheckout(false);
      setCheckoutSession(null);
      setCheckoutPlan(null);

      // Poll for Pro status (the webhook processes asynchronously)
      const upgraded = await reconcileFlutterwaveStatus();
      if (upgraded) {
        authActions.setIsPro(true);
        authActions.setEntitlementSynced(true, "flutterwave");
        const session = checkoutSessionRef.current;
        track(AnalyticsEvents.PURCHASE_SUCCESS, {
          plan: checkoutPlanRef.current ?? null,
          amount: session?.amount ?? null,
          currency: session?.currency ?? null,
        });
        AppAlert.success(
          "Welcome to Pro!",
          "Your subscription is active. Thank you for supporting Ekwe!",
        );
      }
    },
    []
  );

  // ── Checkout Dismiss ─────────────────────────────────────────

  const handleCheckoutDismiss = useCallback(() => {
    setShowCheckout(false);
    setCheckoutSession(null);
    setCheckoutPlan(null);
    checkoutSessionRef.current = null;
    checkoutPlanRef.current = null;
  }, []);

  // ── Manage Handler ──────────────────────────────────────────

  const handleManage = async (): Promise<void> => {
    AppAlert.info(
      "Manage Subscription",
      "To manage or cancel your subscription, please visit your billing portal or contact support.",
    );
  };

  // ── Restore Handler ──────────────────────────────────────────

  const handleRestore = async (): Promise<void> => {
    // Flutterwave doesn't have a restore concept — check session directly
    const { data: sessionData, error } = await supabase.auth.refreshSession();
    if (error) throw error;

    const upgraded =
      sessionData.session?.user?.app_metadata?.is_pro === true;
    authActions.setIsPro(upgraded);
    if (upgraded) {
      authActions.setEntitlementSynced(true, "flutterwave");
    }

    if (upgraded) {
      AppAlert.success(
        "Subscription Active",
        "Your Pro subscription is active.",
      );
    } else {
      AppAlert.info(
        "No Active Subscription",
        "We could not find an active Pro subscription on this account. If you believe this is an error, please contact support.",
      );
    }
  };

  return {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
    handleManage,
    handleRestore,
    freePlan: BILLING_PLANS.free,
    proPlan: BILLING_PLANS.pro,
    annualSavingPercent: pricing.annualSavingPercent,
    loading,
    provider,
    availableProviders,
    showCheckout,
    checkoutSession,
    checkoutPlan,
    handleCheckoutComplete,
    handleCheckoutDismiss,
  };
}