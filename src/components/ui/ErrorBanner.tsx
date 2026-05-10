/**
 * ErrorBanner — Inline error message. Renders nothing when empty.
 */
import React from 'react';
import { View, Text } from 'react-native';

interface ErrorBannerProps {
  message: string | null | undefined;
}

export const ErrorBanner = ({
  message,
}: ErrorBannerProps): React.ReactElement | null =>
  message ? (
    <View
      style={{
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        padding: 12,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(239, 68, 68, 0.15)',
      }}
    >
      <Text
        style={{
          color: '#EF4444',
          fontFamily: 'Outfit-Medium',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        {message}
      </Text>
    </View>
  ) : null;
