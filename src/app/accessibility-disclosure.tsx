import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { AccessibilityDisclosure } from '@/components';
import { useForegroundApp, useTheme } from '@/hooks';

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

  const Container = process.env.EXPO_OS === 'ios' ? BlurView : View;
  const containerProps =
    process.env.EXPO_OS === 'ios'
      ? { intensity: 80, tint: isDark ? ('dark' as const) : ('light' as const) }
      : { style: { flex: 1, backgroundColor: color.background } };

  return (
    <Container {...containerProps} style={styles.flex1}>
      <AccessibilityDisclosure onAgree={handleAgree} onDeny={handleDeny} />
    </Container>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
});
