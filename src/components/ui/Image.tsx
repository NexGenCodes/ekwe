import { Image as ExpoImage } from "expo-image";
import type {
  ImageContentFit,
  ImageContentPosition,
  ImageSource,
} from "expo-image";
import React, { forwardRef } from "react";
import type { ImageStyle, StyleProp } from "react-native";

export interface ImageProps {
  source: ImageSource;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  contentPosition?: ImageContentPosition;
  transition?: number;
  tintColor?: string;
  priority?: "low" | "normal" | "high";
  cachePolicy?: "disk" | "memory" | "memory-disk";
}

export const Image = React.memo(
  forwardRef<ExpoImage, ImageProps>((props, ref) => (
    <ExpoImage ref={ref} {...props} />
  )),
);

Image.displayName = "Image";
