import React, { useEffect, useCallback } from "react";
import { Modal, Linking, View, ActivityIndicator } from "react-native";
import type { CheckoutSession } from "@/services/flutterwave";
import { AppAlert } from "@/utils/alert";
import { Box, Text, Pressable } from "@/components/ui";

interface CheckoutSheetProps {
  visible: boolean;

  session: CheckoutSession | null;

  plan: string | null;

  onDismiss: () => void;
  onComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;
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
  useEffect(() => {
    if (visible && session?.link) {
      Linking.openURL(session.link).catch((_err) => {
        AppAlert.error("Checkout Error", "Failed to open payment browser");
        onDismiss();
      });
    }
  }, [visible, session, onDismiss]);

  const handleVerify = useCallback(() => {
    if (session) {
      onComplete({
        status: null, // let backend polling verify
        tx_ref: session.tx_ref,
        transaction_id: null,
      });
    }
  }, [onComplete, session]);

  if (!visible || !session) return null;

  const planLabel =
    PLAN_LABELS[plan?.replace("ekwe_pro_", "") ?? "monthly"] ?? "Monthly";

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <Box
          style={{
            backgroundColor: "#1C1C1E",
            padding: 24,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          <ActivityIndicator
            size="large"
            color="#FFFFFF"
            style={{ marginBottom: 20 }}
          />
          <Text
            variant="heading2"
            style={{ color: "#FFFFFF", marginBottom: 12, textAlign: "center" }}
          >
            Awaiting Payment
          </Text>
          <Text
            variant="body"
            style={{ color: "#A1A1AA", textAlign: "center", marginBottom: 24 }}
          >
            Your secure {planLabel} checkout opened in a browser window. Once
            you complete the payment, tap the button below.
          </Text>

          <Pressable
            onPress={handleVerify}
            style={{
              backgroundColor: "#007AFF",
              padding: 16,
              borderRadius: 12,
              width: "100%",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <Text
              variant="body"
              style={{ color: "#FFFFFF", fontWeight: "bold" }}
            >
              I've Completed Payment
            </Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            style={{ padding: 16, width: "100%", alignItems: "center" }}
          >
            <Text variant="body" style={{ color: "#FF3B30" }}>
              Cancel Checkout
            </Text>
          </Pressable>
        </Box>
      </View>
    </Modal>
  );
}
