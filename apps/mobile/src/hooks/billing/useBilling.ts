import { useSelector } from "@legendapp/state/react";
import { useMutation } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";

import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { BILLING_PLANS } from "@/constants/billing";
import { PRO_PLAN_IDS } from "@ekwe/shared/plans";
import { supabase } from "@/services/supabase";
import { auth$, authActions } from "@/store";
import { AppAlert } from "@/utils/alert";
import { fetchWithRetry } from "@/utils/networkUtils";

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
}

const PRO_POLL_ATTEMPTS = 8;
const PRO_POLL_INTERVAL_MS = 2000;

/**
 * After the in-app browser closes, the payment webhook usually hasn't landed
 * yet. Instead of trusting a single refresh, re-mint the session a few times
 * (each refresh re-runs the access-token hook, which embeds the new is_pro)
 * until Pro shows up or we give up.
 */
async function reconcileProStatus(): Promise<boolean> {
  for (let attempt = 0; attempt < PRO_POLL_ATTEMPTS; attempt++) {
    const { data: sessionData, error } = await supabase.auth.refreshSession();
    if (error) throw error;

    if (sessionData.session) {
      authActions.setSession(sessionData.session);
      if (sessionData.session.user?.app_metadata?.is_pro === true) {
        return true;
      }
    }

    if (attempt < PRO_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PRO_POLL_INTERVAL_MS));
    }
  }
  return false;
}

export function useBilling(): UseBillingReturn {
  const isPro = useSelector(() => auth$.isPro.get());
  const [isAnnual, setIsAnnual] = useState(true);
  const { pricing } = useActivePricing();

  const checkoutMutation = useMutation({
    mutationFn: async ({
      planId,
      currency,
      accessToken,
    }: {
      planId: string;
      currency: string;
      accessToken: string;
    }) => {
      const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
      if (!workerUrl) {
        throw new Error("API server configuration is missing.");
      }

      const response = await fetchWithRetry(
        `${workerUrl}/checkout/initialize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            plan_id: planId,
            currency,
          }),
          // Initialization is a stateful POST that should NOT be retried on a
          // 5xx (the payment provider may have already created the link).
          // Retry only on transport-level failures (the request never hit the
          // worker): one extra attempt keeps flaky mobile connections happy.
          retries: 2,
          retryOnHttpResponse: false,
        },
      );

      if (!response.ok) {
        let errMessage = "Failed to initialize secure checkout";
        try {
          const body = (await response.json()) as { message?: string };
          if (body.message) {
            errMessage = body.message;
          }
        } catch {
          // ignore
        }
        throw new Error(errMessage);
      }

      const resData = (await response.json()) as {
        url: string;
        reference: string;
      };
      if (!resData.url) {
        throw new Error("Invalid checkout URL received from server.");
      }

      return resData;
    },
  });

  const handleUpgrade = async (): Promise<void> => {
    const session = auth$.session.get();
    if (!session) {
      AppAlert.info(
        "Account Required",
        "Please sign in or create an account to upgrade to Ekwe Pro.",
      );
      return;
    }

    try {
      const data = await checkoutMutation.mutateAsync({
        planId: isAnnual ? PRO_PLAN_IDS.annual : PRO_PLAN_IDS.monthly,
        currency: pricing.currency,
        accessToken: session.access_token,
      });

      await WebBrowser.openBrowserAsync(data.url, {
        showTitle: true,
        enableBarCollapsing: true,
      });

      const upgraded = await reconcileProStatus();

      if (upgraded) {
        AppAlert.success(
          "Welcome to Pro!",
          "Your payment was processed successfully. Thank you for supporting Ekwe!",
        );
      } else {
        AppAlert.info(
          "Syncing Status",
          "We are verifying your transaction. If your account is not upgraded in a minute, please contact support.",
        );
      }
    } catch (err: unknown) {
      AppAlert.error("Upgrade Failed", err);
    }
  };

  const handleManage = async (): Promise<void> => {
    AppAlert.info(
      "Manage Subscription",
      "You can manage your subscription from your device settings or contact support at support@ekwe.app.",
    );
  };

  const handleRestore = async (): Promise<void> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      const restoredIsPro = data.session?.user?.app_metadata?.is_pro === true;
      authActions.setIsPro(restoredIsPro);
      if (restoredIsPro) {
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
    } catch {
      AppAlert.error(
        "Status Check Failed",
        "Could not verify your subscription. Please try again or contact support.",
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
    loading: checkoutMutation.isPending,
  };
}
