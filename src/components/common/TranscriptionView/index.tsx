import React from 'react';
import { View, Text } from 'react-native';

interface Props {
  transcript: string;
  isLive?: boolean;
}

export const TranscriptionView = ({
  transcript,
  isLive = false,
}: Props): React.JSX.Element => {
  return (
    <View className="rounded-3xl p-6 border border-border bg-card min-h-[140px] shadow-sm">
      <Text className="font-body text-xl leading-9 text-foreground">
        {transcript || (isLive ? 'Listening...' : 'Waiting for audio...')}
      </Text>

      {isLive && (
        <View className="flex-row items-center mt-6">
          <View className="w-2.5 h-2.5 rounded-full mr-2.5 bg-primary animate-pulse" />
          <Text className="font-bodyMed text-xs uppercase tracking-widest text-muted">
            Live Stream
          </Text>
        </View>
      )}
    </View>
  );
};
