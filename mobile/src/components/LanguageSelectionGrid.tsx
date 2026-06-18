import { FlashList } from "@shopify/flash-list";
import React, { memo, useCallback } from "react";
import { View } from "react-native";

import { LanguageGridCard } from "@/components/language";
import { LANGUAGES, getLanguageName } from "@/constants/languages";
import { spacing } from "@/constants/spacing";
import { useTokens } from "@/hooks/ui";

export interface LanguageSelectionGridProps {
  selected: string[];
  onToggle: (code: string) => void;
}

interface ItemData {
  code: string;
  label: string;
}

const NUM_COLUMNS = 2;
const COLUMN_GAP = spacing.sm + spacing.xs;

const LanguageGridItem = memo(function LanguageGridItem({
  code,
  label,
  isSelected,
  onToggle,
  index,
}: {
  code: string;
  label: string;
  isSelected: boolean;
  onToggle: (code: string) => void;
  index: number;
}) {
  const columnIndex = index % NUM_COLUMNS;
  return (
    <View
      style={{
        flex: 1,
        paddingLeft: columnIndex === 1 ? COLUMN_GAP / 2 : 0,
        paddingRight: columnIndex === 0 ? COLUMN_GAP / 2 : 0,
        paddingBottom: COLUMN_GAP,
      }}
    >
      <LanguageGridCard
        code={code}
        label={label}
        isSelected={isSelected}
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
}: LanguageSelectionGridProps): React.ReactElement {
  const { spacing } = useTokens();

  const data: ItemData[] = React.useMemo(
    () =>
      LANGUAGES.map((lang) => ({
        code: lang.code,
        label: getLanguageName(lang.code),
      })),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ItemData; index: number }) => (
      <LanguageGridItem
        code={item.code}
        label={item.label}
        isSelected={selected.includes(item.code)}
        onToggle={onToggle}
        index={index}
      />
    ),
    [selected, onToggle],
  );

  const keyExtractor = useCallback((item: ItemData) => item.code, []);

  return (
    <FlashList
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      numColumns={NUM_COLUMNS}
      contentContainerStyle={{
        paddingTop: spacing.md,
        paddingBottom: spacing["2xl"],
      }}
      scrollEnabled={false}
    />
  );
}
