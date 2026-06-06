import React, { forwardRef } from "react";
import { View, type ViewProps } from "react-native";

export type BoxProps = ViewProps;

export const Box = React.memo(
  forwardRef<View, BoxProps>(({ style, ...props }, ref) => (
    <View ref={ref} style={style} {...props} />
  )),
);

Box.displayName = "Box";
