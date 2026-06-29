import React from "react";
import { StyleSheet } from "react-native";
import { SharedValue } from "react-native-reanimated";

import { AudioWaveform } from "@/components/AudioWaveform";
import { Card } from "@/components/Card";
import { Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export interface ResultAudioWaveformProps {
  progressSV: SharedValue<number>;
  amplitudes: number[];
}

export function ResultAudioWaveform({
  progressSV,
  amplitudes,
}: ResultAudioWaveformProps): React.JSX.Element {
  const { color } = useTheme();

  return (
    <Card style={{ padding: spacing.lg, borderRadius: borderRadius["2xl"] }}>
      <Text
        variant="caption"
        style={[
          styles.title,
          {
            color: color.muted,
          },
        ]}
      >
        Voice Architecture
      </Text>
      <AudioWaveform
        amplitudes={amplitudes}
        progressSV={progressSV}
        duration={1}
        height={60}
        interactive={false}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
});
