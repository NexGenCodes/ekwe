import { useRouter } from 'expo-router';
import React from 'react';

import { AccessibilityDisclosure } from '@/components/common/AccessibilityDisclosure/AccessibilityDisclosure';
import { useForegroundApp } from '@/hooks/useForegroundApp';

export default function AccessibilityDisclosureScreen(): React.ReactElement {
  const router = useRouter();
  const { requestPermission } = useForegroundApp();

  const handleAgree = async (): Promise<void> => {
    // Trigger the native permission request
    await requestPermission();
    // Navigate back to settings
    router.back();
  };

  const handleDeny = (): void => {
    router.back();
  };

  return <AccessibilityDisclosure onAgree={handleAgree} onDeny={handleDeny} />;
}
