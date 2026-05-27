import { useSelector } from '@legendapp/state/react';
import * as WebBrowser from 'expo-web-browser';
import { useState, useMemo } from 'react';

import { BILLING_PLANS, DISPLAY_PRICING } from '@/constants/billing';
import { supabase } from '@/services/supabase';
import { auth$, settings$ } from '@/store';
import { AppAlert } from '@/utils/alert';

export interface UseBillingReturn {
  isPro: boolean;
  isAnnual: boolean;
  setIsAnnual: (isAnnual: boolean) => void;
  handleUpgrade: () => Promise<void>;
  handleManage: () => Promise<void>;
  freePlan: typeof BILLING_PLANS.free;
  proPlan: typeof BILLING_PLANS.pro & { annualSavingPercent: number };
  currentPrice: number;
  loading: boolean;
}

export function useBilling(): UseBillingReturn {
  const isPro = useSelector(() => auth$.isPro.get());
  const currency = useSelector(() => settings$.currency.get());
  const [isAnnual, setIsAnnual] = useState(true);
  const [loading, setLoading] = useState(false);

  const activePricing = useMemo(() => {
    return DISPLAY_PRICING[currency] || DISPLAY_PRICING.USD;
  }, [currency]);

  const handleUpgrade = async (): Promise<void> => {
    const session = auth$.session.get();
    if (!session) {
      AppAlert.info(
        'Account Required',
        'Please sign in or create an account to upgrade to Ekwe Pro.',
      );
      return;
    }

    setLoading(true);
    try {
      const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? '';
      if (!workerUrl) {
        throw new Error('API server configuration is missing.');
      }

      const response = await fetch(`${workerUrl}/checkout/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          plan_id: isAnnual ? 'pro_annual' : 'pro_monthly',
          currency,
        }),
      });

      if (!response.ok) {
        let errMessage = 'Failed to initialize secure checkout';
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
        throw new Error('Invalid checkout URL received from server.');
      }

      // Open the payment gateway URL in the in-app WebBrowser
      await WebBrowser.openBrowserAsync(resData.url, {
        showTitle: true,
        enableBarCollapsing: true,
      });

      // After user closes the checkout browser, refresh their Supabase session to sync is_pro state
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        throw error;
      }

      const updatedIsPro = data.session?.user?.app_metadata?.is_pro === true;
      if (updatedIsPro) {
        AppAlert.success(
          'Welcome to Pro!',
          'Your payment was processed successfully. Thank you for supporting Ekwe!',
        );
      } else {
        // Fallback info if the webhook hasn't finished processing or failed
        AppAlert.info(
          'Syncing Status',
          'We are verifying your transaction. If your account is not upgraded in a minute, please contact support.',
        );
      }
    } catch (err: unknown) {
      AppAlert.error('Upgrade Failed', err);
    } finally {
      setLoading(false);
    }
  };

  const handleManage = async (): Promise<void> => {
    AppAlert.info(
      'Manage Subscription',
      'You can manage your subscription from your device settings or contact support at support@ekwe.app.',
    );
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
    freePlan,
    proPlan,
    currentPrice,
    loading,
  };
}
