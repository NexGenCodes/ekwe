import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React from "react";
import { KeyboardAvoidingView } from "react-native";

import { AuthBackground } from "@/components/AuthBackground";
import { Text, Pressable, SafeArea, ScrollArea } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { isIOS } from "@/utils";

export interface AuthShellProps {
  showBackButton?: boolean;
  children: React.ReactNode;
}

export const AuthShell = ({
  showBackButton = false,
  children,
}: AuthShellProps): React.ReactElement => {
  const { color } = useTheme();
  const router = useRouter();

  return (
    <SafeArea style={{ flex: 1, backgroundColor: color.background }}>
      <AuthBackground>
        {showBackButton && (
          <Pressable
            onPress={() => router.back()}
            style={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              zIndex: 10,
            }}
            hitSlop={12}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <ChevronLeft size={20} color={color.foreground} />
            <Text variant="body" style={{ color: color.foreground }}>
              Back
            </Text>
          </Pressable>
        )}
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
          keyboardVerticalOffset={isIOS ? 0 : 24}
        >
          <ScrollArea
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              padding: spacing.xl,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollArea>
        </KeyboardAvoidingView>
      </AuthBackground>
    </SafeArea>
  );
};
