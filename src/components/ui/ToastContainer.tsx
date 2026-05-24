import React from 'react';
import { Toaster } from 'sonner-native';

import { useTheme } from '@/hooks/ui/useTheme';

export function ToastContainer(): React.ReactElement {
  const { isDark } = useTheme();

  return <Toaster theme={isDark ? 'dark' : 'light'} position="top-center" />;
}
