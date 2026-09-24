import React, { useCallback, useEffect, useRef } from "react";
import { PayWithFlutterwave } from "flutterwave-react-native-sdk";
import type { ComponentProps } from "react";

import type { CheckoutSession } from "@/services/flutterwave";
import { getFlutterwavePublicKey } from "@/services/flutterwave";
import { AppAlert } from "@/utils/alert";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";

type SdkOptions = ComponentProps<typeof PayWithFlutterwave>["options"];

interface CheckoutSheetProps {
  visible: boolean;

  session: CheckoutSession | null;

  plan: string | null;

  email: string;
  onDismiss: () => void;
  onComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;
}

const BASE_PAYMENT_OPTIONS = ["card", "banktransfer", "ussd", "account"];

const MOBILE_MONEY_OPTIONS: Partial<Record<FlutterwaveCurrency, string[]>> = {
  KES: ["mpesa"],
  GHS: ["mobilemoneyghana"],
  UGX: ["mobilemoneyuganda"],
  RWF: ["mobilemoneyrwanda"],
  ZMW: ["mobilemoneyzambia"],
  TZS: ["mobilemoneytanzania"],
  XOF: ["mobilemoneyxof"],
  XAF: ["mobilemoneyxaf"],
};

export function getPaymentOptions(currency: string): string {
  const extra = MOBILE_MONEY_OPTIONS[currency as FlutterwaveCurrency] ?? [];
  return [...BASE_PAYMENT_OPTIONS, ...extra].join(",");
}

const PLAN_LABELS: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

export function CheckoutSheet({
  visible,
  session,
  plan,
  email,
  onDismiss,
  onComplete,
}: CheckoutSheetProps): React.ReactElement | null {
  const triggerPressRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (visible && session) {
      requestAnimationFrame(() => triggerPressRef.current?.());
    }
  }, [visible, session]);

  const handleInitializeError = useCallback(
    (err: unknown) => {
      const message =
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof err.message === "string"
          ? err.message
          : "Payment could not be started.";
      AppAlert.error("Checkout Error", message);
      onDismiss();
    },
    [onDismiss],
  );

  const handleRedirect = useCallback(
    (data: { status: string; tx_ref: string; transaction_id?: string }) => {
      onComplete({
        status: data.status,
        tx_ref: data.tx_ref,
        transaction_id: data.transaction_id ?? null,
      });
    },
    [onComplete],
  );

  if (!visible || !session) return null;

  const planLabel =
    PLAN_LABELS[plan?.replace("ekwe_pro_", "") ?? "monthly"] ?? "Monthly";

  const options: SdkOptions = {
    amount: session.amount,
    currency: session.currency,
    payment_options: getPaymentOptions(session.currency),

    authorization: session.public_key || getFlutterwavePublicKey(),
    tx_ref: session.tx_ref,
    customer: {
      email,
    },

    meta: {
      plan,
      amount: session.amount,
      currency: session.currency,
    },
    customizations: {
      title: "Ekwe Pro",
      description: `Upgrade to Ekwe Pro (${planLabel.toLowerCase()})`,
    },
  } as SdkOptions;

  return (
    <>
      <PayWithFlutterwave
        key={session.tx_ref}
        options={options}
        customButton={({ onPress }) => {
          triggerPressRef.current = onPress;
          return null;
        }}
        onInitializeError={handleInitializeError}
        onAbort={onDismiss}
        onRedirect={handleRedirect}
      />
    </>
  );
}
