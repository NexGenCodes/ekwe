import { useSelector } from "@legendapp/state/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView } from "react-native";

import {
  HomeHeader,
  TranslationInterface,
  BackgroundFlair,
} from "@/components/home";
import { Box, SafeArea, ScrollArea } from "@/components/ui";
import { spacing } from "@/constants";
import { settings$ } from "@/store";
import { isIOS } from "@/utils";

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const onboardingCompleted = useSelector(() =>
    settings$.onboardingCompleted.get(),
  );
  const [isInputFocused, setIsInputFocused] = useState(false);


  useEffect(() => {
    if (!onboardingCompleted) {
      router.replace("/(onboarding)/language");
    }
  }, [onboardingCompleted, router]);

  return (
    <SafeArea >
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
    </SafeArea>
  );
}
