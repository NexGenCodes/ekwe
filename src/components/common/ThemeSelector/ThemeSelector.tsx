import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Sun, Moon, Laptop, Check } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';

import { getColor } from '@/constants/colors';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store';
import { ThemePreference } from '@/store/settingsSlice';

interface ThemeSelectorProps {
  isVisible: boolean;
  onClose: () => void;
}

export const ThemeSelector = ({
  isVisible,
  onClose,
}: ThemeSelectorProps): React.ReactElement => {
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const { themePreference, setThemePreference } = useSettingsStore();

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['40%'], []);

  const bgColor = getColor('background', isDark);
  const handleColor = getColor('border', isDark);
  const primaryColor = getColor('primary', isDark);

  useEffect(() => {
    if (isVisible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [isVisible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        onPress={onClose}
      />
    ),
    [onClose],
  );

  const options = [
    {
      id: ThemePreference.Light,
      label: 'Light',
      icon: Sun,
    },
    {
      id: ThemePreference.Dark,
      label: 'Dark',
      icon: Moon,
    },
    {
      id: ThemePreference.System,
      label: 'System',
      icon: Laptop,
    },
  ];

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: bgColor,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
      }}
      handleIndicatorStyle={{
        backgroundColor: handleColor,
        width: 40,
      }}
    >
      <View className="px-6 pt-2 pb-8">
        <Text className="font-display text-2xl mb-6 text-foreground dark:text-foreground-dark text-center">
          Appearance
        </Text>

        <View className="bg-card dark:bg-card-dark rounded-3xl overflow-hidden border border-border dark:border-border-dark">
          {options.map((option, index) => {
            const Icon = option.icon;
            const isSelected = themePreference === option.id;

            return (
              <Pressable
                key={option.id}
                onPress={() => {
                  setThemePreference(option.id);
                  // Give it a tiny delay for the UI to feel "tapped" before closing
                  setTimeout(onClose, 150);
                }}
                className={`flex-row items-center justify-between px-5 py-5 active:opacity-60 ${
                  index < options.length - 1
                    ? 'border-b border-border dark:border-border-dark'
                    : ''
                }`}
              >
                <View className="flex-row items-center">
                  <Icon
                    size={22}
                    color={
                      isSelected ? primaryColor : getColor('muted', isDark)
                    }
                    strokeWidth={2}
                  />
                  <Text
                    className={`ml-4 text-lg font-body ${
                      isSelected ? 'text-foreground font-bodyMed' : 'text-muted'
                    }`}
                  >
                    {option.label}
                  </Text>
                </View>

                {isSelected && (
                  <View className="bg-primary/10 dark:bg-primary-dark/10 w-8 h-8 rounded-full items-center justify-center">
                    <Check size={18} color={primaryColor} strokeWidth={3} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
};
