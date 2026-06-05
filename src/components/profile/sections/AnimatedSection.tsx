import React from "react";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ProfileSection } from "../ProfileSection";

import { duration } from "@/constants/motion";

interface AnimatedSectionProps {
  delay: number;
  title: string;
  titleColor?: string;
  children: React.ReactNode;
}

export function AnimatedSection({
  delay,
  title,
  titleColor,
  children,
}: AnimatedSectionProps): React.JSX.Element {
  return (
    <Animated.View entering={FadeInDown.duration(duration.normal).delay(delay)}>
      <ProfileSection title={title} titleColor={titleColor}>
        {children}
      </ProfileSection>
    </Animated.View>
  );
}
