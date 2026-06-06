import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import React from "react";

import { AccessibilityDisclosure } from "@/components";
import { Box } from "@/components/ui";
import { useForegroundApp, useTheme } from "@/hooks";
import { isIOS } from "@/utils";

export default function AccessibilityDisclosureScreen(): React.ReactElement {
  const router = useRouter();
  const { requestPermission } = useForegroundApp();
  const { color, isDark } = useTheme();

  const handleAgree = async (): Promise<void> => {
    // Trigger the native permission request
    await requestPermission();
    // Navigate back to settings
    router.back();
  };

  const handleDeny = (): void => {
    router.back();
  };

  const Container = isIOS ? BlurView : Box;
  const containerProps = isIOS
    ? { intensity: 80, tint: isDark ? ("dark" as const) : ("light" as const) }
    : { style: { flex: 1, backgroundColor: color.background } };

  return (
    <Container {...containerProps} style={styles.flex1}>
      <AccessibilityDisclosure onAgree={handleAgree} onDeny={handleDeny} />
    </Container>
  );
}

const styles = {
  flex1: { flex: 1 } as const,
};
