import { Check } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withTiming,
  FadeIn,
} from 'react-native-reanimated';
import { getColor } from 'src/constants/theme';

interface SelectionCardProps {
  label: string;
  subLabel?: string;
  icon?: string;
  isSelected?: boolean;
  onPress: () => void;
  className?: string;
}

export const SelectionCard = ({
  label,
  subLabel,
  icon,
  isSelected = false,
  onPress,
  className = '',
}: SelectionCardProps): React.ReactElement => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const scale = useSharedValue(1);
  const opacity = useSharedValue(isSelected ? 1 : 0);

  React.useEffect(() => {
    opacity.value = withTiming(isSelected ? 1 : 0, { duration: 250 });
  }, [isSelected]);

  const handlePressIn = (): void => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = (): void => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: isSelected
      ? getColor('primaryAccent', isDark)
      : isDark
        ? 'rgba(39, 39, 42, 0.5)' // zinc-800
        : 'rgba(228, 228, 231, 0.5)', // zinc-200
  }));

  const checkCircleStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: withSpring(isSelected ? 1 : 0.6) }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        entering={FadeIn.duration(400)}
        style={animatedStyle}
        className={`h-[72px] flex-row items-center px-5 rounded-2xl border-[1.5px] bg-card dark:bg-card-dark shadow-sm active:scale-[0.98] transition-all duration-200 ease-in-out ${className}`}
      >
        <View className="flex-1 flex-row items-center">
          {icon && <Text className="text-2xl mr-4">{icon}</Text>}
          <View>
            <Text className="text-base font-body text-zinc-950 dark:text-zinc-50 tracking-tight">
              {label}
            </Text>
            {subLabel && (
              <Text className="text-xs font-body text-zinc-500 dark:text-zinc-400 mt-0.5">
                {subLabel}
              </Text>
            )}
          </View>
        </View>

        <Animated.View
          style={checkCircleStyle}
          className="w-6 h-6 rounded-full items-center justify-center bg-primary dark:bg-primary-dark"
        >
          <Check size={14} color="#FFFFFF" strokeWidth={3} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};
