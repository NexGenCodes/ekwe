import React from 'react';
import Svg, { Path, Rect, Ellipse } from 'react-native-svg';

interface EkweLogoProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  opacity?: number;
}

export function EkweLogo({
  size = 40,
  color = '#FFFFFF',
  strokeWidth = 2.5,
  opacity = 1,
}: EkweLogoProps): React.ReactElement {
  // Scale the stroke width relative to the 100x100 viewBox
  const sw = strokeWidth * 3.125;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      opacity={opacity}
    >
      {/* Central Solid Pill Capsule */}
      <Rect x="38" y="20" width="24" height="44" rx="12" fill={color} />

      {/* U-Bracket */}
      <Path
        d="M24 42v8a26 26 0 0 0 52 0v-8"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />

      {/* Oval Base */}
      <Ellipse cx="50" cy="82" rx="22" ry="6" stroke={color} strokeWidth={sw} />

      {/* Left Outer Sound Wave Arc */}
      <Path
        d="M16 28 Q-2 53 16 78"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />

      {/* Right Outer Sound Wave Arc */}
      <Path
        d="M84 28 Q102 53 84 78"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </Svg>
  );
}
