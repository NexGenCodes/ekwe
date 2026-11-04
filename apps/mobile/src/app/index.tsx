import { useValue } from "@legendapp/state/react";
import { Redirect } from "expo-router";

import { Box, Spinner } from "@/components/ui";
import { useTheme } from "@/hooks/ui/useTheme";
import { settings$ } from "@/store/settings";
import { auth$ } from "@/store/auth";

export default function Index(): React.ReactElement | null {
  const { color } = useTheme();
  const isInitialized = useValue(() => auth$.isInitialized.get());
  const sessionLoaded = useValue(() => auth$.sessionLoaded.get());
  const session = useValue(() => auth$.session.get());
  const onboardingCompleted = useValue(() =>
    settings$.onboardingCompleted.get(),
  );

  if (!isInitialized || !sessionLoaded) {
    return (
      <Box
        style={{
          flex: 1,
          backgroundColor: color.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spinner size="lg" color={color.brand} />
      </Box>
    );
  }

  if (!onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;

  if (!session) return <Redirect href="/(auth)/login" />;

  return <Redirect href="/(tabs)" />;
}
