import React, { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";

interface CheckoutSheetProps {
  visible: boolean;
  checkoutUrl: string;
  onDismiss: () => void;
  onComplete: (data: {
    status: string | null;
    tx_ref: string | null;
    transaction_id: string | null;
  }) => void;
}

export function CheckoutSheet({
  visible,
  checkoutUrl,
  onDismiss,
  onComplete,
}: CheckoutSheetProps): React.JSX.Element {
  const [webviewKey, setWebviewKey] = useState(0);

  useEffect(() => {
    if (visible) {
      setWebviewKey((k) => k + 1);
    }
  }, [visible, checkoutUrl]);

  const handleNavigationStateChange = useCallback(
    (navState: { url?: string }) => {
      if (navState.url?.includes("flutterwave.com/rn-redirect")) {
        const url = new URL(navState.url);
        const status = url.searchParams.get("status");
        const tx_ref = url.searchParams.get("tx_ref");
        const transaction_id = url.searchParams.get("transaction_id");
        onDismiss();
        onComplete({ status, tx_ref, transaction_id });
      }
    },
    [onDismiss, onComplete]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.container}>
        <WebView
          key={webviewKey}
          source={{ uri: checkoutUrl }}
          style={styles.webview}
          onNavigationStateChange={handleNavigationStateChange}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsBackForwardNavigationGestures
          startInLoadingState
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});
