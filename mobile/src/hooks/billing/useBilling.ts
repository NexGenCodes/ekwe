import { useSelector } from "@legendapp/state/react";
import { useMutation } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState, useMemo } from "react";

import { BILLING_PLANS, DISPLAY_PRICING } from "@/constants/billing";
import { SUPPORTED_CURRENCIES } from "@/constants/currency";
import { usePlanConfigQuery } from "@/hooks/queries/usePlanConfigQuery";
import { supabase } from "@/services/supabase";
import { auth$, authActions, settings$ } from "@/store";
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
  proPlan: typeof BILLING_PLANS.pro & { annualSavingPercent: number };
  currentPrice: number;
  loading: boolean;
}

export function useBilling(): UseBillingReturn {
  const isPro = useSelector(() => auth$.isPro.get());
  const currency = useSelector(() => settings$.currency.get());
  const [isAnnual, setIsAnnual] = useState(true);
  const { data: config } = usePlanConfigQuery();

  const activePricing = useMemo(() => {
    const serverPricing = config?.pricing?.[currency] ?? config?.pricing?.USD;
    if (serverPricing) {
      const symbol =
        SUPPORTED_CURRENCIES.find((c) => c.code === serverPricing.monthly.currency)?.symbol ?? "$";
      const monthlyAmount = serverPricing.monthly.amount;
      const annualAmount = serverPricing.annual.amount;
      return {
        monthly: { amount: monthlyAmount, currency, symbol },
        annual: { amount: annualAmount, currency, symbol },
        annualMonthlyCost: +(annualAmount / 12).toFixed(2),
        annualSavingPercent: Math.round((1 - annualAmount / (monthlyAmount * 12)) * 100),
      };
    }
    return DISPLAY_PRICING[currency] || DISPLAY_PRICING.USD;
  }, [currency, config]);

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
          retries: 2,
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
        planId: isAnnual ? "pro_annual" : "pro_monthly",
        currency,
        accessToken: session.access_token,
      });

      await WebBrowser.openBrowserAsync(data.url, {
        showTitle: true,
        enableBarCollapsing: true,
      });

      const { data: sessionData, error } = await supabase.auth.refreshSession();
      if (error) {
        throw error;
      }

      const updatedIsPro =
        sessionData.session?.user?.app_metadata?.is_pro === true;
      if (updatedIsPro) {
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
          "Purchases Restored",
          "Your Pro subscription has been restored.",
        );
      } else {
        AppAlert.info(
          "No Purchases Found",
          "We could not find any previous purchases to restore. If you believe this is an error, please contact support.",
        );
      }
    } catch {
      AppAlert.error(
        "Restore Failed",
        "Could not verify purchases. Please try again or contact support.",
      );
    }
  };

  const freePlan = BILLING_PLANS.free;

  const proPlan = useMemo(() => {
    return {
      ...BILLING_PLANS.pro,
      annualSavingPercent: activePricing.annualSavingPercent,
    };
  }, [activePricing]);

  const currentPrice = isAnnual
    ? activePricing.annualMonthlyCost
    : activePricing.monthly.amount;

  return {
    isPro,
    isAnnual,
    setIsAnnual,
    handleUpgrade,
    handleManage,
    handleRestore,
    freePlan,
    proPlan,
    currentPrice,
    loading: checkoutMutation.isPending,
  };
}
