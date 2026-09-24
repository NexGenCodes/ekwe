import React from "react";
import Svg, { Path, Ellipse, Rect } from "react-native-svg";

import { iconSize } from "@/constants/sizes";
import { useTheme } from "@/hooks";

export interface EkweLogoProps {
  size?: number;

  color?: string;
}

export const EkweLogo = ({
  size = iconSize.md,
  color,
}: EkweLogoProps): React.JSX.Element => {
  const { color: themeColor } = useTheme();

  const fill = color ?? themeColor.brand;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      accessibilityElementsHidden
    >
      {}
      <Rect x="37" y="10" width="26" height="42" rx="13" fill={fill} />

      {}
      <Path
        d="M30 38 C30 58 38 66 50 66 C62 66 70 58 70 38"
        stroke={fill}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {}
      <Path
        d="M50 66 L50 76"
        stroke={fill}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {}
      <Ellipse cx="50" cy="80" rx="16" ry="5" stroke={fill} strokeWidth="4.5" />

      {}
      <Path
        d="M 26 16.8 A 32 32 0 0 0 26 59.2"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {}
      <Path
        d="M 74 16.8 A 32 32 0 0 1 74 59.2"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {}
      <Path
        d="M 14 11 A 45 45 0 0 0 14 65"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {}
      <Path
        d="M 86 11 A 45 45 0 0 1 86 65"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </Svg>
  );
};
