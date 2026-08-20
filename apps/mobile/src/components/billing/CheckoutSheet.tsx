import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { PayWithFlutterwave } from "flutterwave-react-native-sdk";
import type { ComponentProps } from "react";

import type { CheckoutSession } from "@/services/flutterwave";
import { getFlutterwavePublicKey } from "@/services/flutterwave";
import { Box, Spinner, Text } from "@/components/ui";
import { useTheme } from "@/hooks";
import { AppAlert } from "@/utils/alert";

type SdkOptions = ComponentProps<typeof PayWithFlutterwave>["options"];

interface CheckoutSheetProps {
  visible: boolean;
  /** The worker-authorized session (tx_ref, amount, currency) for the SDK. */
  session: CheckoutSession | null;
  /** The plan id echoed back in meta so the webhook can resolve it. */
  plan: string | null;
  /** The signed-in user's email (required by Flutterwave customer). */
  email: string;
  onDismiss: () => void;
  onComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;
}

/**
 * Flutterwave SDK checkout. Mounts `PayWithFlutterwave` (which renders its
 * own full-screen checkout modal) and auto-triggers initialization via the
 * `customButton` render-prop's `onPress`, captured into a ref.
 *
 * `key={session.tx_ref}` remounts the SDK per session so its SAME_TXREF
 * guard never blocks a repeat checkout for the same user+plan.
 */
export function CheckoutSheet({
  visible,
  session,
  plan,
  email,
  onDismiss,
  onComplete,
}: CheckoutSheetProps): React.ReactElement | null {
  const { color } = useTheme();
  const [initializing, setInitializing] = useState(false);
  const triggerPressRef = useRef<(() => void) | null>(null);

  const handleWillInitialize = useCallback(() => {
    setInitializing(true);
  }, []);

  const handleDidInitialize = useCallback(() => {
    setInitializing(false);
  }, []);

  const handleInitializeError = useCallback(
    (err: unknown) => {
      setInitializing(false);
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
    [onDismiss]
  );

  const handleRedirect = useCallback(
    (data: { status: string; tx_ref: string; transaction_id?: string }) => {
      onComplete({
        status: data.status,
        tx_ref: data.tx_ref,
        transaction_id: data.transaction_id ?? null,
      });
    },
    [onComplete]
  );

  // Trigger SDK initialization once the sheet becomes visible and the SDK
  // has had a chance to render (populating triggerPressRef via customButton).
  useEffect(() => {
    if (visible && session) {
      triggerPressRef.current?.();
    }
  }, [visible, session]);

  if (!visible || !session) return null;

  const options: SdkOptions = {
    amount: session.amount,
    currency: session.currency,
    payment_options: "card",
    authorization: getFlutterwavePublicKey(),
    tx_ref: session.tx_ref,
    customer: {
      email,
    },
    // Echoed back in the webhook so the worker can verify the charged
    // amount/currency and resolve the plan.
    meta: {
      plan,
      amount: session.amount,
      currency: session.currency,
    },
    customizations: {
      title: "Ekwe Pro",
      description: `Upgrade to Ekwe Pro (${plan?.replace("ekwe_pro_", "") ?? "monthly"})`,
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
        onWillInitialize={handleWillInitialize}
        onDidInitialize={handleDidInitialize}
        onInitializeError={handleInitializeError}
        onAbort={onDismiss}
        onRedirect={handleRedirect}
      />
      {initializing && (
        <View style={[styles.overlay, { backgroundColor: color.overlay }]}>
          <Box style={[styles.card, { backgroundColor: color.background }]}>
            <Spinner size="lg" color={color.foreground} />
            <Text variant="bodySmall" style={{ color: color.muted }}>
              Starting secure payment…
            </Text>
          </Box>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  card: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 16,
  },
});