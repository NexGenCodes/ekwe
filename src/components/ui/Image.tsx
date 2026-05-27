import React, { forwardRef } from 'react';
import {
  Image as RNImage,
  type ImageProps as RNImageProps,
} from 'react-native';

export type ImageProps = RNImageProps;

export const Image = React.memo(
  forwardRef<RNImage, ImageProps>(({ style, ...props }, ref) => (
    <RNImage ref={ref} accessibilityRole="image" style={style} {...props} />
  )),
);

Image.displayName = 'Image';
