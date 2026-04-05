import { Info, CheckCircle2, AlertCircle, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React from 'react';
import { View, Text, Pressable, ViewStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { EkweButton } from 'src/components/common/EkweButton';
import { getColor } from 'src/constants/colors';

export interface EkweBannerProps {
  message: string;
  title?: string;
  visible?: boolean;
  type?: 'info' | 'success' | 'warning' | 'error';
  variant?: 'info' | 'success' | 'warning' | 'error';
  action?: {
    label: string;
    onPress: () => void;
  };
  onDismiss?: () => void;
  onClose?: () => void;
  style?: ViewStyle;
}

interface VariantConfig {
  icon: typeof Info;
  color: string;
  bg: string;
  border: string;
}

const getVariantConfig = (isDark: boolean): Record<string, VariantConfig> => ({
  info: {
    icon: Info,
    color: getColor('info', isDark),
    bg: 'bg-blue-50 dark:bg-blue-900/10',
    border: 'border-blue-200/50 dark:border-blue-800/50',
  },
  success: {
    icon: CheckCircle2,
    color: getColor('success', isDark),
    bg: 'bg-emerald-50 dark:bg-emerald-900/10',
    border: 'border-emerald-200/50 dark:border-emerald-800/50',
  },
  warning: {
    icon: AlertCircle,
    color: getColor('warning', isDark),
    bg: 'bg-amber-50 dark:bg-amber-900/10',
    border: 'border-amber-200/50 dark:border-amber-800/50',
  },
  error: {
    icon: AlertCircle,
    color: getColor('error', isDark),
    bg: 'bg-red-50 dark:bg-red-900/10',
    border: 'border-red-200/50 dark:border-red-800/50',
  },
});

export const BannerPresets = {
  noInternet: {
    type: 'error' as const,
    title: 'No Internet Connection',
    message: 'Translations may be slow or unavailable.',
    visible: true,
  },
};

export const EkweBanner: React.FC<EkweBannerProps> = ({
  message,
  title,
  visible = true,
  type = 'info',
  variant,
  action,
  onDismiss,
  onClose,
  style,
}) => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (!visible) return null;

  const currentType = variant || type;
  const config = getVariantConfig(isDark)[currentType];
  const Icon = config.icon;

  return (
    <Animated.View
      entering={FadeInUp}
      exiting={FadeOutUp}
      className={`p-4 rounded-2xl border ${config.bg} ${config.border} flex-row items-start`}
      style={style}
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
        {action && (
          <View className="mt-3">
            <EkweButton
              variant="secondary"
              size="small"
              label={action.label}
              onPress={action.onPress}
            />
          </View>
        )}
      </View>
      {(onClose || onDismiss) && (
        <Pressable
          onPress={onClose || onDismiss}
          className="ml-2 p-1 active:opacity-60"
        >
          <X size={16} color={getColor('muted', isDark)} />
        </Pressable>
      )}
    </Animated.View>
  );
};
