import React, { useEffect, useCallback, useState } from "react";
import { Modal, Linking, View } from "react-native";
import type { CheckoutSession } from "@/services/flutterwave";
import { AppAlert } from "@/utils/alert";
import { Box, Text, Spinner, Pressable } from "@/components/ui";
import { Button } from "@/components/Button";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

interface CheckoutSheetProps {
  visible: boolean;
  session: CheckoutSession | null;
  plan: string | null;
  onDismiss: () => void;
  onComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void | Promise<void>;
}

const PLAN_LABELS: Record<string, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

export function CheckoutSheet({
  visible,
  session,
  plan,
  onDismiss,
  onComplete,
}: CheckoutSheetProps): React.ReactElement | null {
  const { color } = useTheme();
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!visible || !session) return;
    if (!session.link) {
      AppAlert.error(
        "Payment Unavailable",
        "The payment page could not be opened. Please try again.",
      );
      onDismiss();
      return;
    }
    Linking.openURL(session.link).catch((_err) => {
      AppAlert.error("Checkout Error", "Failed to open payment browser");
      onDismiss();
    });
  }, [visible, session, onDismiss]);

  const handleVerify = useCallback(async () => {
    if (session && !isVerifying) {
      setIsVerifying(true);
      try {
        await onComplete({
          status: null, // let backend polling verify
          tx_ref: session.tx_ref,
          transaction_id: null,
        });
      } finally {
        setIsVerifying(false);
      }
    }
  }, [onComplete, session, isVerifying]);

  if (!visible || !session) return null;

  const planLabel =
    PLAN_LABELS[plan?.replace("ekwe_pro_", "") ?? "monthly"] ?? "Monthly";

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View
        style={{
          flex: 1,
          backgroundColor: color.overlay,
          justifyContent: "center",
          padding: spacing.xl,
        }}
      >
        <Box
          style={{
            backgroundColor: color.card,
            padding: spacing.xl,
            borderRadius: borderRadius["2xl"],
            borderWidth: 1,
            borderColor: color.border,
            alignItems: "center",
            maxWidth: 420,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <Box style={{ marginBottom: spacing.lg }}>
            <Spinner size="lg" color={color.brand} />
          </Box>
          <Text
            variant="heading2"
            style={{
              color: color.foreground,
              marginBottom: spacing.sm,
              textAlign: "center",
            }}
          >
            Awaiting Payment
          </Text>
          <Text
            variant="body"
            style={{
              color: color.muted,
              textAlign: "center",
              marginBottom: spacing.xl,
              lineHeight: 22,
            }}
          >
            Your secure {planLabel} checkout opened in your browser. Once you
            complete the payment, tap the button below to confirm.
          </Text>

          <Button
            label="I've Completed Payment"
            onPress={handleVerify}
            loading={isVerifying}
            disabled={isVerifying}
            size="large"
            style={{ width: "100%", marginBottom: spacing.sm }}
          />

          <Pressable
            onPress={onDismiss}
            disabled={isVerifying}
            hitSlop={8}
            style={{
              paddingVertical: spacing.md,
              width: "100%",
              alignItems: "center",
              opacity: isVerifying ? 0.4 : 1,
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel checkout"
          >
            <Text
              variant="bodySmall"
              style={{ color: color.error, fontWeight: "600" }}
            >
              Cancel Checkout
            </Text>
          </Pressable>
        </Box>
      </View>
    </Modal>
  );
}
