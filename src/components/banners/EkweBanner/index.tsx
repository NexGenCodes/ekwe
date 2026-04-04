import { Info, CheckCircle2, AlertCircle, X } from 'lucide-react-native';
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

interface EkweBannerProps {
  message: string;
  title?: string;
  visible: boolean;
  variant?: 'info' | 'success' | 'warning' | 'error';
  onClose?: () => void;
}

const VARIANT_CONFIG = {
  info: {
    icon: Info,
    color: '#1A7EC8',
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    border: 'border-blue-200/50 dark:border-blue-800/50',
  },
  success: {
    icon: CheckCircle2,
    color: '#10B981',
    bg: 'bg-emerald-50 dark:bg-emerald-900/10',
    border: 'border-emerald-200/50 dark:border-emerald-800/50',
  },
  warning: {
    icon: AlertCircle,
    color: '#F59E0B',
    bg: 'bg-amber-50 dark:bg-amber-900/10',
    border: 'border-amber-200/50 dark:border-amber-800/50',
  },
  error: {
    icon: AlertCircle,
    color: '#EF4444',
    bg: 'bg-red-50 dark:bg-red-900/10',
    border: 'border-red-200/50 dark:border-red-800/50',
  },
};

export const EkweBanner: React.FC<EkweBannerProps> = ({
  message,
  title,
  visible,
  variant = 'info',
  onClose,
}) => {
  if (!visible) return null;

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <Animated.View
      entering={FadeInUp}
      exiting={FadeOutUp}
      className={`p-4 rounded-2xl border ${config.bg} ${config.border} flex-row items-start`}
    >
      <Icon
        size={20}
        color={config.color}
        style={{ marginTop: 2, marginRight: 12 }}
      />
      <View className="flex-1">
        {title && (
          <Text className="font-bodyMed text-sm text-zinc-950 dark:text-zinc-50 mb-0.5">
            {title}
          </Text>
        )}
        <Text className="font-body text-xs text-zinc-600 dark:text-zinc-400 leading-[18px]">
          {message}
        </Text>
      </View>
      {onClose && (
        <Pressable onPress={onClose} className="ml-2 p-1 active:opacity-60">
          <X size={16} color="#A1A1AA" />
        </Pressable>
      )}
    </Animated.View>
  );
};
