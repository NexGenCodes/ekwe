import { useSelector } from "@legendapp/state/react";
import { useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView } from "react-native";

import {
  HomeHeader,
  TranslationInterface,
  BackgroundFlair,
} from "@/components/home";
import { Box, ScrollArea } from "@/components/ui";
import { spacing } from "@/constants";
import { settings$ } from "@/store";
import { isIOS } from "@/utils";

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Prewarm the Text-to-Speech engine on mount to eliminate cold-start latency
  useEffect(() => {
    const prewarmTTS = async (): Promise<void> => {
      try {
        await Speech.speak(".", { volume: 0 });
      } catch {
        // Silently ignore prewarm errors
      }
    };
    prewarmTTS();
  }, []);

  useEffect(() => {
    if (!onboardingCompleted) {
      router.replace("/(onboarding)/language");
    }
  }, [onboardingCompleted, router]);

  return (
    <Box style={{ flex: 1 }}>
      <BackgroundFlair />
      <KeyboardAvoidingView
        behavior={isIOS ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={isIOS ? 0 : 20}
      >
        <ScrollArea
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          nestedScrollEnabled
        >
          {/* Main content */}
          <Box style={{ gap: spacing.md }}>
            <HomeHeader />
            <TranslationInterface onInputFocusChange={setIsInputFocused} />
          </Box>
        </ScrollArea>
      </KeyboardAvoidingView>
    </Box>
  );
}
