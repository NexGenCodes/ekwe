import { FlashList } from "@shopify/flash-list";
import React, { memo, useCallback, useMemo } from "react";
import { View } from "react-native";

import { LanguageGridCard } from "@/components/language";
import { LANGUAGES, getLanguageName } from "@/constants/languages";
import { spacing } from "@/constants/spacing";

export interface LanguageSelectionGridProps {
  selected: string[];
  onToggle: (code: string) => void;
  isMaxed?: boolean;
  horizontalInset?: number;
  contentContainerStyle?: React.ComponentProps<
    typeof FlashList
  >["contentContainerStyle"];
}

const GUTTER = spacing.sm;

const keyExtractor = (lang: (typeof LANGUAGES)[number]): string => lang.code;

const LanguageGridItem = memo(function LanguageGridItem({
  code,
  label,
  isSelected,
  isMaxed,
  onToggle,
}: {
  code: string;
  label: string;
  isSelected: boolean;
  isMaxed: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <View
      style={{
        paddingHorizontal: GUTTER,
        paddingVertical: GUTTER,
      }}
    >
      <LanguageGridCard
        code={code}
        label={label}
        isSelected={isSelected}
        disabled={!isSelected && isMaxed}
        onPress={() => onToggle(code)}
        width="100%"
        aspectRatio={2.2}
      />
    </View>
  );
});

export function LanguageSelectionGrid({
  selected,
  onToggle,
  isMaxed = false,
  horizontalInset = 0,
  contentContainerStyle,
}: LanguageSelectionGridProps): React.ReactElement {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const renderItem = useCallback(
    ({ item }: { item: (typeof LANGUAGES)[number] }): React.ReactElement => (
      <LanguageGridItem
        code={item.code}
        label={getLanguageName(item.code)}
        isSelected={selectedSet.has(item.code)}
        isMaxed={isMaxed}
        onToggle={onToggle}
      />
    ),
    [selectedSet, isMaxed, onToggle],
  );

  const getItemType = useCallback((): string => "language", []);

  return (
    <FlashList
      data={LANGUAGES}
      numColumns={2}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        {
          paddingTop: spacing.lg,
          paddingBottom: spacing["3xl"],
          paddingHorizontal: horizontalInset - GUTTER,
        },
        contentContainerStyle,
      ]}
    />
  );
}
