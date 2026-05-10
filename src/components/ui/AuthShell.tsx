import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks';

export interface AuthShellProps {
  showBackButton?: boolean;
  children: React.ReactNode;
}

export const AuthShell = ({ showBackButton = false, children }: AuthShellProps): React.ReactElement => {
  const { color } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.background }}>
      {showBackButton && (
        <Pressable
          onPress={() => router.back()}
          style={{
            paddingHorizontal: 20,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
          hitSlop={12}
        >
          <ChevronLeft size={20} color={color.foreground} />
          <Text
            style={{
              fontFamily: 'Outfit-Medium',
              fontSize: 16,
              color: color.foreground,
            }}
          >
            Back
          </Text>
        </Pressable>
      )}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
