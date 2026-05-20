import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { fonts } from '@/constants/fonts';
import { useTheme } from '@/hooks';

interface Props {
  transcript: string;
  isLive?: boolean;
}

export const TranscriptionView = ({
  transcript,
  isLive = false,
}: Props): React.JSX.Element => {
  const { color } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: color.card, borderColor: color.border },
      ]}
    >
      <Text style={[styles.transcriptText, { color: color.foreground }]}>
        {transcript || (isLive ? 'Listening...' : 'Waiting for audio...')}
      </Text>

      {isLive && (
        <View style={styles.liveContainer}>
          <View style={[styles.pulseDot, { backgroundColor: color.primary }]} />
          <Text style={[styles.liveText, { color: color.muted }]}>
            Live Stream
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    minHeight: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  transcriptText: { fontFamily: fonts.body, fontSize: 20, lineHeight: 36 },
  liveContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 24 },
  pulseDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  liveText: {
    fontFamily: fonts.bodyMed,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
});
