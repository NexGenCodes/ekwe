import React, { forwardRef } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

export type ScrollAreaProps = ScrollViewProps;

export const ScrollArea = React.memo(
  forwardRef<ScrollView, ScrollAreaProps>(
    (
      { contentContainerStyle, contentInsetAdjustmentBehavior, ...props },
      ref,
    ) => (
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior={
          contentInsetAdjustmentBehavior ?? "automatic"
        }
        {...props}
      />
    ),
  ),
);

ScrollArea.displayName = "ScrollArea";
