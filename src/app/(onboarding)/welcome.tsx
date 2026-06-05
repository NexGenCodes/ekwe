import { useRouter } from "expo-router";
import { ChevronRight, Globe, Mic, ShieldCheck } from "lucide-react-native";
import Animated from "react-native-reanimated";

import { Button, EkweLogo, FeatureCard } from "@/components";
import { Box, ScreenContainer, Text } from "@/components/ui";
import { useHeaderEntrance } from "@/hooks/useOnboardingAnimation";
import { useTheme, useTokens } from "@/hooks";

const FEATURES = [
  {
    icon: Mic,
    title: "Speak Freely",
    description: "Your words, translated as you speak.",
  },
  {
    icon: Globe,
    title: "Any Language",
    description: "Speak to anyone, anywhere \u2014 100+ languages.",
  },
  {
    icon: ShieldCheck,
    title: "Private by Design",
    description: "Everything stays on your device. No cloud, no copies.",
  },
];

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  const { color } = useTheme();
  const { spacing } = useTokens();
  const headerStyle = useHeaderEntrance();

  return (
    <ScreenContainer
      contentContainerStyle={{
        paddingTop: spacing["2xl"],
        paddingBottom: spacing["6xl"],
        paddingHorizontal:spacing.lg,
        justifyContent: "space-between",
      }}
      style={{ backgroundColor: color.background }}
    >
      <Box>
        <Animated.View
          style={[
            { alignItems: "center", marginBottom: spacing.xl },
            headerStyle,
          ]}
        >
          <Box style={{ marginBottom: spacing.md }}>
            <EkweLogo size={80} color={color.secondary} />
          </Box>
          <Text
            variant="display"
            style={{
              textAlign: "center",
              paddingHorizontal: spacing.md,
            }}
          >
            Every voice understood.
          </Text>
        </Animated.View>

        <Box style={{ gap: spacing.lg }}>
          {FEATURES.map((item, index) => (
            <FeatureCard
              key={item.title}
              icon={item.icon}
              title={item.title}
              description={item.description}
              index={index}
            />
          ))}
        </Box>
      </Box>

      <Box
        style={{
          marginTop: spacing.xl,
        }}
      >
        <Button
          variant="primary"
          size="large"
          label="Get started"
          onPress={() => router.replace("/language")}
          rightIcon={
            <ChevronRight
              size={24}
              color={color.onSecondary}
              strokeWidth={3}
            />
          }
        />
      </Box>
    </ScreenContainer>
  );
}
