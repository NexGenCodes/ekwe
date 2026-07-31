import React from "react";
import Svg, { Path, Ellipse, Rect } from "react-native-svg";

import { iconSize } from "@/constants/sizes";
import { useTheme } from "@/hooks";

export interface EkweLogoProps {
  /** Width & height in dp. Defaults to 48. */
  size?: number;
  /** Override the fill/stroke color (skips theme lookup). */
  color?: string;
}

/**
 * Theme-aware SVG logo for Ekwe — microphone with sound-wave arcs.
 *
 * Matches the splash screen PNG icon exactly:
 * - Filled microphone capsule (rounded pill)
 * - U-shaped microphone body (stroke)
 * - Vertical stand into an oval base
 * - Two pairs of concentric sound-wave arcs
 *
 * All elements share a single color that adapts to light/dark mode.
 */
export const EkweLogo = ({
  size = iconSize.md,
  color,
}: EkweLogoProps): React.JSX.Element => {
  const { color: themeColor } = useTheme();

  // Default to secondary (brand blue) which matches the splash PNG color
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
      {/* Microphone capsule (solid rounded pill) */}
      <Rect x="37" y="10" width="26" height="42" rx="13" fill={fill} />

      {/* Microphone body — U-shape connecting to stand */}
      <Path
        d="M30 38 C30 58 38 66 50 66 C62 66 70 58 70 38"
        stroke={fill}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Vertical stand */}
      <Path
        d="M50 66 L50 76"
        stroke={fill}
        strokeWidth="5.5"
        strokeLinecap="round"
      />

      {/* Oval base */}
      <Ellipse cx="50" cy="80" rx="16" ry="5" stroke={fill} strokeWidth="4.5" />

      {/* Inner sound-wave arc — left */}
      <Path
        d="M 26 16.8 A 32 32 0 0 0 26 59.2"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* Inner sound-wave arc — right */}
      <Path
        d="M 74 16.8 A 32 32 0 0 1 74 59.2"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* Outer sound-wave arc — left */}
      <Path
        d="M 14 11 A 45 45 0 0 0 14 65"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />

      {/* Outer sound-wave arc — right */}
      <Path
        d="M 86 11 A 45 45 0 0 1 86 65"
        stroke={fill}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </Svg>
  );
};
