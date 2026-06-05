import Animated from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
  animatedStyle?: Record<string, unknown>; // Replaced any with record to satisfy linting while maintaining compatibility
}

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

export const SpinnerIcon = ({
  size = 24,
  color = "currentColor",
  animatedStyle,
}: IconProps): React.ReactElement => (
  <AnimatedSvg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    style={animatedStyle}
  >
    <Path
      d="M12 2V6"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M12 18V22"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M4.93 4.93L7.76 7.76"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M16.24 16.24L19.07 19.07"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M2 12H6"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M18 12H22"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M4.93 19.07L7.76 16.24"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M16.24 7.76L19.07 4.93"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </AnimatedSvg>
);
